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
import { apiFor, type MailProvider } from "@/lib/api";

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
  // `opts.writeback` is true on the incremental-consent upgrade. Microsoft must
  // re-request the write scope set here (its refresh tokens are scope-bound);
  // Google derives scopes from the code and ignores it.
  exchangeCodeForTokens: (code: string, opts: { writeback: boolean }) => Promise<CallbackTokens>;
  fetchProfile: (accessToken: string) => Promise<CallbackProfile>;
  /** Parse the granted scope string. `hasReadonly` gates the connect flow;
   *  `hasWriteback` decides whether the incremental-consent upgrade succeeded. */
  parseScopes: (scope: string) => {
    scopes: string[];
    hasReadonly: boolean;
    hasWriteback: boolean;
  };
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
  let isWritebackUpgrade = false;
  try {
    const rawState = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8"),
    ) as { workspaceId: string };
    workspaceId = rawState.workspaceId;
    const verified = verifyState(state, user.id, workspaceId);
    isWritebackUpgrade = verified.intent === "writeback";
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
    tokens = await cfg.exchangeCodeForTokens(code, { writeback: isWritebackUpgrade });
  } catch (err) {
    console.error(`[${cfg.source}] token_exchange:`, err instanceof Error ? err.message : err);
    return fail("token_exchange");
  }

  // Enforce read-only scope before making any provider API calls.
  const { scopes: grantedScopes, hasReadonly, hasWriteback } = cfg.parseScopes(tokens.scope);
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

  // ── Incremental-consent upgrade ──────────────────────────────────────────────
  // The writeback flow re-consents an ALREADY-connected mailbox to add the write
  // scope. It must not run the fresh-connect machinery (inbox-rotation cleanup,
  // post-connect sync/watch, field-resetting upsert) against a healthy mailbox —
  // it only widens the stored grant and flips the feature on.
  if (isWritebackUpgrade) {
    return handleWritebackUpgrade({
      cfg,
      workspaceId,
      userId: user.id,
      profile,
      grantedScopes,
      hasWriteback,
      encryptedRefreshToken: encrypt(tokens.refreshToken),
      baseUrl,
      fail,
    });
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

  // Writeback is on by default and the write scope is requested upfront: when it
  // was granted, kick off folder→label provisioning now (the PATCH enqueues the
  // worker job). Best-effort — a failure just delays labels until the first
  // classification lazily provisions them.
  if (hasWriteback) {
    await apiFor(user.id)
      .updateGmailSyncSettings(workspaceId, { labelWritebackEnabled: true })
      .catch((err) =>
        console.error(
          `[${cfg.source}] writeback_provision:`,
          err instanceof Error ? err.message : err,
        ),
      );
  }

  return NextResponse.redirect(new URL("/emails", baseUrl));
}

/**
 * Complete an incremental-consent upgrade: verify the same mailbox re-consented,
 * widen the stored grant with the new refresh token + scopes, and — if the write
 * scope was actually granted — enable label writeback (which enqueues folder
 * provisioning via the API). If the user declined the write scope, the read-only
 * connection is still refreshed but the feature stays off. Never resets
 * provider-scoped connection state, rotates inboxes, or re-triggers sync/watch.
 */
async function handleWritebackUpgrade(opts: {
  cfg: OAuthCallbackConfig;
  workspaceId: string;
  userId: string;
  profile: CallbackProfile;
  grantedScopes: string[];
  hasWriteback: boolean;
  encryptedRefreshToken: string;
  baseUrl: string;
  fail: (reason: string) => NextResponse;
}): Promise<NextResponse> {
  const { cfg, workspaceId, userId, profile, grantedScopes, hasWriteback, fail } = opts;
  const settingsRedirect = (params: Record<string, string>): NextResponse => {
    const url = new URL("/settings", opts.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return NextResponse.redirect(url);
  };

  const existing = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { emailAddress: true, subjectId: true },
  });
  if (!existing) {
    // Nothing to upgrade — the mailbox must be connected first.
    return fail("writeback_no_connection");
  }

  // Same-mailbox guard: a subjectId match (Outlook) is authoritative; otherwise
  // compare the address (Gmail, which has no stable subject id). Prevents
  // upgrading connection A's grant with a token minted for mailbox B.
  const sameMailbox =
    existing.subjectId && profile.subjectId
      ? existing.subjectId === profile.subjectId
      : existing.emailAddress.toLowerCase() === profile.emailAddress.toLowerCase();
  if (!sameMailbox) return fail("wrong_account");

  // Widen the stored grant (fresh refresh token + scopes). Deliberately a narrow
  // update — NOT persistEmailConnection/upsert, which resets watch/status fields.
  try {
    await db.emailConnection.update({
      where: { workspaceId },
      data: {
        encryptedRefreshToken: opts.encryptedRefreshToken,
        grantedScopes,
        lastVerifiedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`[${cfg.source}] writeback_update:`, err instanceof Error ? err.message : err);
    return fail("db_upsert");
  }

  // User re-consented but declined the write scope: keep the refreshed read-only
  // connection, leave the feature off.
  if (!hasWriteback) {
    return settingsRedirect({ [cfg.errorParam]: "writeback_scope_denied" });
  }

  // Enable writeback through the API (the single place that enqueues folder
  // provisioning). Audit here so the scope upgrade is observable even if the
  // enable call fails.
  await db.auditLog
    .create({
      data: {
        workspaceId,
        actorType: "USER",
        actorUserId: userId,
        eventType: "connection.writeback_enabled",
        entityType: cfg.audit.entityType,
        metadata: { [cfg.audit.addressKey]: profile.emailAddress },
      },
    })
    .catch((err) => console.error(`[${cfg.source}] writeback_audit:`, err instanceof Error ? err.message : err));

  try {
    await apiFor(userId).updateGmailSyncSettings(workspaceId, { labelWritebackEnabled: true });
  } catch (err) {
    console.error(`[${cfg.source}] writeback_enable:`, err instanceof Error ? err.message : err);
    // Scope is granted and stored; the user can flip the toggle from settings.
    return settingsRedirect({ [cfg.errorParam]: "writeback_enable_failed" });
  }

  return settingsRedirect({ writeback: "enabled" });
}
