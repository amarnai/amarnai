import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import {
  exchangeCodeForTokens,
  fetchOutlookProfile,
} from "@/lib/outlook-oauth";
import { verifyState } from "@/lib/gmail-oauth";
import { encrypt } from "@/lib/encryption";
import { triggerPostConnectHooks } from "@/lib/post-connect-hooks";
import { parseGrantedScopes } from "@amarnai/outlook";
import { db, deleteGmailDisconnectedNotifications } from "@amarnai/db";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const msError = searchParams.get("error");

  const baseUrl = (process.env["AUTH_URL"] ?? req.nextUrl.origin).replace(/\/$/, "");
  const settingsUrl = new URL("/settings", baseUrl);

  if (msError) {
    settingsUrl.searchParams.set("outlook_error", "access_denied");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("outlook_error", "invalid_callback");
    return NextResponse.redirect(settingsUrl);
  }

  // requireUser() calls redirect() internally when unauthenticated. Let that
  // propagate naturally to the Next.js runtime — do not wrap in try/catch.
  const user = await requireUser();

  // ── Verify OAuth state (provider-neutral signing) ───────────────────────────
  let workspaceId: string;
  try {
    const rawState = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8")
    ) as { workspaceId: string };
    workspaceId = rawState.workspaceId;
    verifyState(state, user.id, workspaceId);
  } catch {
    settingsUrl.searchParams.set("outlook_error", "invalid_state");
    return NextResponse.redirect(settingsUrl);
  }

  // ── Re-verify workspace ownership (defense in depth) ─────────────────────────
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: user.id },
    select: { id: true },
  });
  if (!workspace) {
    settingsUrl.searchParams.set("outlook_error", "unauthorized");
    return NextResponse.redirect(settingsUrl);
  }

  // ── Step 1: exchange authorization code for Microsoft OAuth tokens ───────────
  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    console.error("[outlook/callback] token_exchange:", err instanceof Error ? err.message : err);
    settingsUrl.searchParams.set("outlook_error", "token_exchange");
    return NextResponse.redirect(settingsUrl);
  }

  // Enforce read-only scope before making any Graph API calls. Microsoft echoes
  // scopes without the resource prefix, so match case-insensitively.
  const { scopes: grantedScopes, hasReadonly } = parseGrantedScopes(tokens.scope);
  if (!hasReadonly) {
    console.error("[outlook/callback] insufficient_scope granted:", tokens.scope);
    settingsUrl.searchParams.set("outlook_error", "insufficient_scope");
    return NextResponse.redirect(settingsUrl);
  }

  // ── Step 2: fetch the Outlook profile using the Graph access token ───────────
  // Verifies the token has Graph access and yields a stable Entra object id.
  let profile: Awaited<ReturnType<typeof fetchOutlookProfile>>;
  try {
    profile = await fetchOutlookProfile(tokens.accessToken);
  } catch (err) {
    console.error("[outlook/callback] profile_fetch:", err instanceof Error ? err.message : err);
    settingsUrl.searchParams.set("outlook_error", "profile_fetch");
    return NextResponse.redirect(settingsUrl);
  }

  // Prior inbox on this workspace (if any) so the audit below can flag a rotation.
  const priorConnection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { emailAddress: true, status: true },
  });

  // ── Step 3: persist the connection ───────────────────────────────────────────
  // One connection per workspace (workspaceId is @unique): connecting Outlook
  // replaces any existing Gmail connection for this workspace and vice versa.
  // Unlike Gmail, Graph returns a stable subjectId (Entra object id) up front.
  try {
    const encryptedRefreshToken = encrypt(tokens.refreshToken);
    const connectionData = {
      provider: "OUTLOOK" as const,
      subjectId: profile.subjectId,
      emailAddress: profile.emailAddress,
      encryptedRefreshToken,
      grantedScopes,
      status: "ACTIVE" as const,
      lastVerifiedAt: new Date(),
      // Clear any stale Gmail push-watch expiry when swapping providers.
      watchExpiresAt: null,
    };
    await db.emailConnection.upsert({
      where: { workspaceId },
      create: { workspaceId, ...connectionData },
      update: connectionData,
    });
  } catch (err) {
    console.error("[outlook/callback] db_upsert:", err instanceof Error ? err.message : err);
    settingsUrl.searchParams.set("outlook_error", "db_upsert");
    return NextResponse.redirect(settingsUrl);
  }

  // Connection is ACTIVE again — clear any "reconnect your account" nudge.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  // Audit the connect (best-effort) so inbox rotation is observable.
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
        eventType: "outlook.connected",
        entityType: "EmailConnection",
        metadata: {
          emailAddress: profile.emailAddress,
          replacedAddress,
          priorStatus: priorConnection?.status ?? null,
        },
      },
    })
    .catch((err) =>
      console.error("[outlook/callback] audit:", err instanceof Error ? err.message : err),
    );

  // ── Step 4: trigger an immediate inbox sync and register the Graph subscription.
  triggerPostConnectHooks("outlook/callback", workspaceId, user.id, "outlook");

  const emailsUrl = new URL("/emails", baseUrl);
  return NextResponse.redirect(emailsUrl);
}
