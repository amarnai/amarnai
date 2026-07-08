import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { verifyState } from "@/lib/gmail-oauth";
import { encrypt } from "@/lib/encryption";
import { persistEmailConnection } from "@/lib/persist-connection";
import { triggerPostConnectHooks } from "@/lib/post-connect-hooks";
import {
  db,
  deleteGmailDisconnectedNotifications,
  eraseStaleEmailAccounts,
} from "@amarnai/db";
import type { MailProvider } from "@/lib/api";

type CallbackTokens = { accessToken: string; refreshToken: string; scope: string };
type CallbackProfile = {
  emailAddress: string;
  // Stable provider subject id (Outlook Entra object id). Null for Gmail, which
  // exposes no stable id for gmail.readonly-only access.
  subjectId: string | null;
};

/**
 * Per-provider hooks + copy for the OAuth connect callback. Everything else in
 * the flow (state verify, ownership re-check, scope enforcement, persist,
 * rotation cleanup, audit, post-connect hooks) is identical across providers and
 * lives in handleOAuthCallback, so Gmail and Outlook cannot drift apart.
 */
export type OAuthCallbackConfig = {
  provider: MailProvider;
  /** User-facing error query-param key on /settings, e.g. "gmail_error". */
  errorParam: string;
  /** Log-line tag and triggerPostConnectHooks source, e.g. "gmail/callback". */
  source: string;
  /** Selects the push-registration endpoint (Gmail watch vs Graph subscription). */
  pushProvider: "gmail" | "outlook";
  /** Error code emitted when the profile fetch fails (provider-specific key the
   *  settings error map keys off — "gmail_profile_fetch" vs "profile_fetch"). */
  profileFetchError: string;
  exchangeCodeForTokens: (code: string) => Promise<CallbackTokens>;
  fetchProfile: (accessToken: string) => Promise<CallbackProfile>;
  /** Parse the granted scope string and decide whether read-only access was granted. */
  parseScopes: (scope: string) => { scopes: string[]; hasReadonly: boolean };
  audit: {
    eventType: string;
    entityType: string;
    /** Metadata key for the connected address ("gmailAddress" vs "emailAddress"). */
    addressKey: string;
  };
};

/**
 * Shared handler for the Gmail and Outlook OAuth connect callbacks. Exchanges the
 * authorization code, enforces read-only scope, persists the (provider-neutral)
 * connection, rotates stale inbox data, audits the connect, and kicks off the
 * immediate sync + push registration. Provider differences are injected via cfg.
 */
export async function handleOAuthCallback(
  req: NextRequest,
  cfg: OAuthCallbackConfig,
): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const providerError = searchParams.get("error");

  const baseUrl = (process.env["AUTH_URL"] ?? req.nextUrl.origin).replace(/\/$/, "");
  const settingsUrl = new URL("/settings", baseUrl);
  const fail = (reason: string): NextResponse => {
    settingsUrl.searchParams.set(cfg.errorParam, reason);
    return NextResponse.redirect(settingsUrl);
  };

  if (providerError) return fail("access_denied");
  if (!code || !state) return fail("invalid_callback");

  // requireUser() calls redirect() internally when unauthenticated. Let that
  // propagate naturally to the Next.js runtime — do not wrap in try/catch.
  const user = await requireUser();

  // ── Verify OAuth state (provider-neutral signing) ───────────────────────────
  let workspaceId: string;
  try {
    const rawState = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8"),
    ) as { workspaceId: string };
    workspaceId = rawState.workspaceId;
    verifyState(state, user.id, workspaceId);
  } catch {
    return fail("invalid_state");
  }

  // ── Re-verify workspace ownership (defense in depth) ─────────────────────────
  // Ownership was checked when generating the OAuth URL, but verify again here in
  // case it changed before the callback completed.
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: user.id },
    select: { id: true },
  });
  if (!workspace) return fail("unauthorized");

  // ── Step 1: exchange authorization code for OAuth tokens ─────────────────────
  let tokens: CallbackTokens;
  try {
    tokens = await cfg.exchangeCodeForTokens(code);
  } catch (err) {
    console.error(`[${cfg.source}] token_exchange:`, err instanceof Error ? err.message : err);
    return fail("token_exchange");
  }

  // Enforce read-only scope before making any provider API calls.
  const { scopes: grantedScopes, hasReadonly } = cfg.parseScopes(tokens.scope);
  if (!hasReadonly) {
    console.error(`[${cfg.source}] insufficient_scope granted:`, tokens.scope);
    return fail("insufficient_scope");
  }

  // ── Step 2: fetch the mailbox profile using the access token ─────────────────
  // Verifies the token actually has API access before we store it, and yields the
  // address plus (for Outlook) a stable subject id.
  let profile: CallbackProfile;
  try {
    profile = await cfg.fetchProfile(tokens.accessToken);
  } catch (err) {
    console.error(`[${cfg.source}] profile_fetch:`, err instanceof Error ? err.message : err);
    return fail(cfg.profileFetchError);
  }

  // Prior inbox on this workspace (if any) so the audit below can flag a ROTATION
  // — connecting a different inbox than was there before.
  const priorConnection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { emailAddress: true, status: true },
  });

  // ── Step 3: persist the connection ───────────────────────────────────────────
  // One connection per workspace (workspaceId is @unique): connecting one provider
  // replaces any existing connection for this workspace. persistEmailConnection
  // resets every provider-scoped field so the swap cannot inherit stale state.
  try {
    await persistEmailConnection({
      workspaceId,
      provider: cfg.provider,
      subjectId: profile.subjectId,
      emailAddress: profile.emailAddress,
      encryptedRefreshToken: encrypt(tokens.refreshToken),
      grantedScopes,
    });
  } catch (err) {
    console.error(`[${cfg.source}] db_upsert:`, err instanceof Error ? err.message : err);
    return fail("db_upsert");
  }

  // Connection is ACTIVE again — clear any "reconnect your account" nudge so it
  // doesn't linger after a successful reconnect. Best-effort.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  // ── Inbox-rotation cleanup ───────────────────────────────────────────────────
  // One connection per workspace: if this connects a DIFFERENT inbox than was
  // synced before, the prior inbox's threads would otherwise be spliced into this
  // inbox's view. Erase any account that isn't the one now connected. The key
  // mirrors the sync worker's derivation (subjectId ?? emailAddress; Gmail stores
  // no subjectId, so it is the address), so reconnecting the same inbox preserves
  // its data. Runs before the sync worker (re)creates the account, so only stale
  // accounts can match. Best-effort.
  const keepProviderAccountId = profile.subjectId ?? profile.emailAddress;
  let erasedInboxes: string[] = [];
  try {
    erasedInboxes = await eraseStaleEmailAccounts(workspaceId, keepProviderAccountId);
  } catch (err) {
    console.error(`[${cfg.source}] rotation_cleanup:`, err instanceof Error ? err.message : err);
  }

  // Audit the connect (best-effort) so inbox rotation is observable.
  // `replacedAddress` is set only on a real inbox swap.
  const replacedAddress =
    priorConnection?.emailAddress && priorConnection.emailAddress !== profile.emailAddress
      ? priorConnection.emailAddress
      : null;
  await db.auditLog
    .create({
      data: {
        workspaceId,
        actorType: "USER",
        actorUserId: user.id,
        eventType: cfg.audit.eventType,
        entityType: cfg.audit.entityType,
        metadata: {
          [cfg.audit.addressKey]: profile.emailAddress,
          replacedAddress,
          priorStatus: priorConnection?.status ?? null,
          erasedInboxes,
        },
      },
    })
    .catch((err) =>
      console.error(`[${cfg.source}] audit:`, err instanceof Error ? err.message : err),
    );

  // ── Step 4: trigger an immediate inbox sync and register push ────────────────
  // Both are fire-and-forget. Failures are non-fatal — the polling scheduler
  // provides a fallback for sync, and the worker's daily renewal covers push.
  triggerPostConnectHooks(cfg.source, workspaceId, user.id, cfg.pushProvider);

  return NextResponse.redirect(new URL("/emails", baseUrl));
}
