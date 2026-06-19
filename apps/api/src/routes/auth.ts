import { Hono } from "hono";
import { z } from "zod";
import {
  issueAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyCredentials,
  registerWithPassword,
  rotateVerificationToken,
  provisionGoogleUser,
  type IssuedRefreshToken,
} from "@amarnai/auth";
import {
  exchangeAuthCode,
  fetchGmailProfile,
  fetchGoogleUserInfo,
  GmailApiError,
  GMAIL_READONLY_SCOPE,
  type GoogleUserInfo,
} from "@amarnai/gmail";
import { RegisterCredentialsSchema } from "@amarnai/shared";
import { sendVerificationEmail } from "@amarnai/email";
import { config } from "@amarnai/config";
import { db } from "@amarnai/db";
import type { AppEnv } from "../env.js";
import { syncInboxQueue } from "../services/queue-client.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// Native clients run the Google OAuth PKCE flow on-device and send the resulting
// authorization code here. redirectUri must match the one used on-device.
const googleSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().min(1),
  codeVerifier: z.string().min(1).optional(),
});

const auth = new Hono<AppEnv>();

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

function tokenPairResponse(accessToken: string, refresh: IssuedRefreshToken): TokenPair {
  return {
    accessToken,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
  };
}

async function issueTokenPair(userId: string): Promise<TokenPair> {
  const [accessToken, refresh] = await Promise.all([
    issueAccessToken(userId),
    issueRefreshToken(userId),
  ]);
  return tokenPairResponse(accessToken, refresh);
}

// Email/password login for native clients. Returns a short-lived access token
// plus a rotating refresh token. Google sign-in is a separate endpoint (next
// slice of the per-user-auth workstream).
auth.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  const userId = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!userId) return c.json({ error: "Invalid email or password" }, 401);

  return c.json(await issueTokenPair(userId));
});

// Email/password sign-up for native clients. Creates the account, emails a
// verification link, and returns a token pair so the app is signed in but in an
// unverified state (the client gates app access on /auth/me's emailVerified).
// Mirrors the web register action's policy via the shared registerWithPassword.
auth.post("/auth/register", async (c) => {
  // Self-serve sign-up policy: honor the same waitlist switch the web enforces.
  if (config.waitlistMode) {
    return c.json({ error: "Sign-ups are currently invite-only." }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = RegisterCredentialsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message ?? "Invalid request" }, 400);
  }

  const result = await registerWithPassword(parsed.data);
  if (result.status === "google_only") {
    return c.json({ error: "An account with this email exists. Sign in with Google instead." }, 409);
  }
  if (result.status === "exists") {
    return c.json({ error: "An account with this email already exists." }, 409);
  }

  // Best-effort: a delivery failure must not block sign-up — the client lands on
  // the verify screen and can resend. Never logs the recipient address.
  await sendVerificationEmail(parsed.data.email, result.verificationToken).catch((err) =>
    console.error("[auth/register] send_verification:", err instanceof Error ? err.message : err)
  );

  return c.json(await issueTokenPair(result.userId));
});

// Google sign-in for native clients. Exchanges the on-device authorization code
// for Gmail tokens, provisions the user + workspace + Gmail connection, and
// returns an Amarnai token pair.
auth.post("/auth/google", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = googleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  let tokens: Awaited<ReturnType<typeof exchangeAuthCode>>;
  try {
    tokens = await exchangeAuthCode(
      parsed.data.code,
      parsed.data.redirectUri,
      parsed.data.codeVerifier
    );
  } catch (err) {
    if (err instanceof GmailApiError) {
      return c.json({ error: "Google authorization failed" }, 401);
    }
    return c.json({ error: "Google authorization failed" }, 400);
  }

  // Enforce the read-only scope before storing anything or calling Gmail.
  const grantedScopes = tokens.scope.split(" ");
  if (!grantedScopes.includes(GMAIL_READONLY_SCOPE)) {
    return c.json({ error: "Gmail read access was not granted" }, 403);
  }

  let email: string;
  try {
    email = (await fetchGmailProfile(tokens.accessToken)).emailAddress;
  } catch {
    return c.json({ error: "Could not read Gmail profile" }, 502);
  }

  // Best-effort: requires openid + profile scopes. Missing fields are fine —
  // provisionGoogleUser treats name/imageUrl as optional.
  const userInfo = await fetchGoogleUserInfo(tokens.accessToken).catch(() => ({} as GoogleUserInfo));

  const result = await provisionGoogleUser({
    email,
    ...(userInfo.name !== undefined ? { name: userInfo.name } : {}),
    ...(userInfo.picture !== undefined ? { imageUrl: userInfo.picture } : {}),
    gmailAccessToken: tokens.accessToken,
    gmailRefreshToken: tokens.refreshToken,
    grantedScopes,
  });

  // First-time sign-up: kick off an immediate inbox sync (fire-and-forget; the
  // polling scheduler is the fallback). Same dedup id as the trigger-sync route
  // so a concurrent webhook does not double-queue. Push-watch registration is
  // covered by the worker's daily renewal.
  if (result.isNew && result.gmailConnected && result.workspaceId) {
    syncInboxQueue
      .add(
        "sync-inbox",
        { workspaceId: result.workspaceId },
        { deduplication: { id: `sync-inbox_${result.workspaceId}` } }
      )
      .catch((err) =>
        console.error("[auth/google] trigger_sync:", err instanceof Error ? err.message : err)
      );
  }

  return c.json(await issueTokenPair(result.userId));
});

// Exchanges a valid refresh token for a fresh token pair, rotating the refresh
// token (single-use). A reused, unknown, or expired token returns 401.
auth.post("/auth/refresh", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  const rotated = await rotateRefreshToken(parsed.data.refreshToken);
  if (!rotated) return c.json({ error: "Invalid refresh token" }, 401);

  const accessToken = await issueAccessToken(rotated.userId);
  return c.json(tokenPairResponse(accessToken, rotated.refresh));
});

// Sign-out: revokes the refresh token. Idempotent — an already-invalid token
// still returns ok so clients can clear local state unconditionally.
auth.post("/auth/logout", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = refreshSchema.safeParse(body);
  if (parsed.success) await revokeRefreshToken(parsed.data.refreshToken);
  return c.json({ ok: true });
});

// Authenticated identity for the current access token. There is no other "me"
// endpoint; native clients use this to resolve the signed-in user and to read
// emailVerified for the post-sign-up verification gate.
auth.get("/auth/me", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerified: true },
  });
  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json({
    userId: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified !== null,
  });
});

// Re-sends the email-verification link for the authenticated user. Throttled to
// one request per minute (same window as the web) to avoid mail flooding.
auth.post("/auth/resend-verification", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      emailVerified: true,
      verificationTokens: {
        where: { type: "EMAIL_VERIFICATION" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.emailVerified) return c.json({ error: "Email is already verified" }, 400);

  const last = user.verificationTokens[0];
  if (last && Date.now() - last.createdAt.getTime() < 60_000) {
    return c.json({ error: "Please wait before requesting another email" }, 429);
  }

  try {
    const token = await rotateVerificationToken(userId);
    await sendVerificationEmail(user.email, token);
  } catch (err) {
    console.error("[auth/resend-verification]:", err instanceof Error ? err.message : err);
    return c.json({ error: "Could not send verification email" }, 502);
  }

  return c.json({ ok: true });
});

export { auth as authRoute };
