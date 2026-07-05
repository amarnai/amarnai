import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import {
  verifyState,
  exchangeCodeForTokens,
  fetchGmailProfile,
} from "@/lib/gmail-oauth";
import { encrypt } from "@/lib/encryption";
import { triggerPostConnectHooks } from "@/lib/post-connect-hooks";
import { GMAIL_READONLY_SCOPE } from "@amarnai/gmail";
import { db, deleteGmailDisconnectedNotifications } from "@amarnai/db";

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
  const priorConnection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { gmailAddress: true, status: true },
  });

  // ── Step 3: persist the connection ───────────────────────────────────────────
  // googleSubjectId is intentionally omitted: Google's tokeninfo endpoints do not
  // reliably return a stable account ID for gmail.readonly-only access tokens
  // without requesting additional scopes. It can be backfilled later.
  try {
    const encryptedRefreshToken = encrypt(tokens.refreshToken);
    await db.gmailConnection.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        gmailAddress: profile.emailAddress,
        encryptedRefreshToken,
        grantedScopes,
        status: "ACTIVE",
        lastVerifiedAt: new Date(),
      },
      update: {
        gmailAddress: profile.emailAddress,
        encryptedRefreshToken,
        grantedScopes,
        status: "ACTIVE",
        lastVerifiedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[gmail/callback] db_upsert:", err instanceof Error ? err.message : err);
    settingsUrl.searchParams.set("gmail_error", "db_upsert");
    return NextResponse.redirect(settingsUrl);
  }

  // Connection is ACTIVE again — clear any "reconnect your account" nudge so it
  // doesn't linger after a successful reconnect. Best-effort.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  // Audit the connect (best-effort) so web inbox rotation is observable, matching
  // the API connect path. `replacedAddress` is set only on a real inbox swap.
  const replacedAddress =
    priorConnection?.gmailAddress && priorConnection.gmailAddress !== profile.emailAddress
      ? priorConnection.gmailAddress
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
