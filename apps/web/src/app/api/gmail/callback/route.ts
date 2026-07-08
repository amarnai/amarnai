import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import {
  verifyState,
  exchangeCodeForTokens,
  fetchGmailProfile,
} from "@/lib/gmail-oauth";
import { encrypt } from "@/lib/encryption";
import { persistEmailConnection } from "@/lib/persist-connection";
import { triggerPostConnectHooks } from "@/lib/post-connect-hooks";
import { GMAIL_READONLY_SCOPE } from "@amarnai/gmail";
import { db, deleteGmailDisconnectedNotifications, eraseStaleEmailAccounts } from "@amarnai/db";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const googleError = searchParams.get("error");

  const baseUrl = (process.env["AUTH_URL"] ?? req.nextUrl.origin).replace(/\/$/, "");
  const settingsUrl = new URL("/settings", baseUrl);

  if (googleError) {
    settingsUrl.searchParams.set("gmail_error", "access_denied");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("gmail_error", "invalid_callback");
    return NextResponse.redirect(settingsUrl);
  }

  // requireUser() calls redirect() internally when unauthenticated. Let that
  // propagate naturally to the Next.js runtime — do not wrap in try/catch.
  const user = await requireUser();

  // ── Verify OAuth state ───────────────────────────────────────────────────────
  let workspaceId: string;
  try {
    const rawState = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8")
    ) as { workspaceId: string };
    workspaceId = rawState.workspaceId;
    verifyState(state, user.id, workspaceId);
  } catch {
    settingsUrl.searchParams.set("gmail_error", "invalid_state");
    return NextResponse.redirect(settingsUrl);
  }

  // ── Re-verify workspace ownership ────────────────────────────────────────────
  // Defense in depth: ownership was checked when generating the OAuth URL, but
  // we verify again here in case it changed before the callback completed.
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: user.id },
    select: { id: true },
  });
  if (!workspace) {
    settingsUrl.searchParams.set("gmail_error", "unauthorized");
    return NextResponse.redirect(settingsUrl);
  }

  // ── Step 1: exchange authorization code for Gmail OAuth tokens ───────────────
  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    console.error("[gmail/callback] token_exchange:", err instanceof Error ? err.message : err);
    settingsUrl.searchParams.set("gmail_error", "token_exchange");
    return NextResponse.redirect(settingsUrl);
  }

  // Enforce read-only scope before making any Gmail API calls.
  const grantedScopes = tokens.scope.split(" ");
  if (!grantedScopes.includes(GMAIL_READONLY_SCOPE)) {
    console.error("[gmail/callback] insufficient_scope granted:", tokens.scope);
    settingsUrl.searchParams.set("gmail_error", "insufficient_scope");
    return NextResponse.redirect(settingsUrl);
  }

  // ── Step 2: fetch Gmail inbox profile using the Gmail OAuth access token ─────
  // This verifies the token actually has Gmail API access before we store it.
  let profile: Awaited<ReturnType<typeof fetchGmailProfile>>;
  try {
    profile = await fetchGmailProfile(tokens.accessToken);
  } catch (err) {
    console.error("[gmail/callback] gmail_profile_fetch:", err instanceof Error ? err.message : err);
    settingsUrl.searchParams.set("gmail_error", "gmail_profile_fetch");
    return NextResponse.redirect(settingsUrl);
  }

  // Prior inbox on this workspace (if any) so the audit below can flag a ROTATION
  // — connecting a different inbox than was there before.
  const priorConnection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { emailAddress: true, status: true },
  });

  // ── Step 3: persist the connection ───────────────────────────────────────────
  // subjectId is null: Google's tokeninfo endpoints do not reliably return a
  // stable account ID for gmail.readonly-only access tokens without requesting
  // additional scopes. persistEmailConnection resets provider/subjectId/watch so
  // switching back from Outlook cannot leave the connection pointing at Outlook.
  try {
    await persistEmailConnection({
      workspaceId,
      provider: "GMAIL",
      subjectId: null,
      emailAddress: profile.emailAddress,
      encryptedRefreshToken: encrypt(tokens.refreshToken),
      grantedScopes,
    });
  } catch (err) {
    console.error("[gmail/callback] db_upsert:", err instanceof Error ? err.message : err);
    settingsUrl.searchParams.set("gmail_error", "db_upsert");
    return NextResponse.redirect(settingsUrl);
  }

  // Connection is ACTIVE again — clear any "reconnect your account" nudge so it
  // doesn't linger after a successful reconnect. Best-effort.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  // ── Inbox-rotation cleanup ───────────────────────────────────────────────────
  // One connection per workspace: if this connects a DIFFERENT inbox than was
  // synced before (another Gmail address, or a prior Outlook inbox), the old
  // inbox's threads would otherwise be spliced into this inbox's view. Erase any
  // account that isn't the one now connected. The key mirrors the sync worker's
  // derivation (subjectId ?? emailAddress; Gmail stores no subjectId, so it is
  // the address), so reconnecting the same inbox preserves its data. Runs before
  // the sync worker (re)creates the account, so only stale accounts match.
  const keepProviderAccountId = profile.emailAddress;
  let erasedInboxes: string[] = [];
  try {
    erasedInboxes = await eraseStaleEmailAccounts(workspaceId, keepProviderAccountId);
  } catch (err) {
    console.error("[gmail/callback] rotation_cleanup:", err instanceof Error ? err.message : err);
  }

  // Audit the connect (best-effort) so web inbox rotation is observable, matching
  // the API connect path. `replacedAddress` is set only on a real inbox swap.
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
        eventType: "gmail.connected",
        entityType: "GmailConnection",
        metadata: {
          gmailAddress: profile.emailAddress,
          replacedAddress,
          priorStatus: priorConnection?.status ?? null,
          erasedInboxes,
        },
      },
    })
    .catch((err) =>
      console.error("[gmail/callback] audit:", err instanceof Error ? err.message : err),
    );

  // ── Step 4: trigger an immediate inbox sync and register push watch ──────────
  // Both are fire-and-forget. Failures are non-fatal — the polling scheduler
  // provides a fallback for sync, and the worker's daily renewal covers watch.
  triggerPostConnectHooks("gmail/callback", workspaceId, user.id);

  const emailsUrl = new URL("/emails", baseUrl);
  return NextResponse.redirect(emailsUrl);
}
