import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import {
  verifyState,
  exchangeCodeForTokens,
  fetchGmailProfile,
} from "@/lib/gmail-oauth";
import { encrypt } from "@/lib/encryption";
import { GMAIL_READONLY_SCOPE } from "@amarnai/gmail";
import { db } from "@amarnai/db";

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
        // Web OAuth callback runs the confidential WEB client. Set on update too
        // so reconnecting via web after a mobile connect corrects the client.
        oauthClient: "WEB",
        status: "ACTIVE",
        lastVerifiedAt: new Date(),
      },
      update: {
        gmailAddress: profile.emailAddress,
        encryptedRefreshToken,
        grantedScopes,
        oauthClient: "WEB",
        status: "ACTIVE",
        lastVerifiedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[gmail/callback] db_upsert:", err instanceof Error ? err.message : err);
    settingsUrl.searchParams.set("gmail_error", "db_upsert");
    return NextResponse.redirect(settingsUrl);
  }

  // ── Step 4: trigger an immediate inbox sync and register push watch ──────────
  // Both are fire-and-forget. Failures are non-fatal — the polling scheduler
  // provides a fallback for sync, and the worker's daily renewal covers watch.
  const apiBase = process.env["API_URL"] ?? "http://localhost:3001";
  const internalSecret = process.env["INTERNAL_API_SECRET"] ?? "dev-internal-secret";
  const authHeader = { Authorization: `Bearer ${internalSecret}`, "X-User-Id": user.id };

  fetch(`${apiBase}/workspaces/${workspaceId}/trigger-sync`, {
    method: "POST",
    headers: authHeader,
  }).catch(
    (err) => console.error("[gmail/callback] trigger_sync:", err instanceof Error ? err.message : err)
  );

  fetch(`${apiBase}/workspaces/${workspaceId}/register-gmail-watch`, {
    method: "POST",
    headers: authHeader,
  }).catch(
    (err) => console.error("[gmail/callback] register_watch:", err instanceof Error ? err.message : err)
  );

  settingsUrl.searchParams.set("gmail_connected", "1");
  return NextResponse.redirect(settingsUrl);
}
