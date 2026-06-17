import { Hono } from "hono";
import { z } from "zod";
import {
  issueAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyCredentials,
  provisionGoogleUser,
} from "@amarnai/auth";
import { exchangeAuthCode, fetchGmailProfile, fetchGoogleUserInfo, GmailApiError, type GoogleUserInfo } from "@amarnai/gmail";
import { syncInboxQueue } from "../services/queue-client.js";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

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

const auth = new Hono();

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

async function issueTokenPair(userId: string): Promise<TokenPair> {
  const [accessToken, refresh] = await Promise.all([
    issueAccessToken(userId),
    issueRefreshToken(userId),
  ]);
  return {
    accessToken,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
  };
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
  if (!grantedScopes.includes(GMAIL_SCOPE)) {
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
  return c.json({
    accessToken,
    refreshToken: rotated.refresh.token,
    refreshTokenExpiresAt: rotated.refresh.expiresAt.toISOString(),
  });
});

// Sign-out: revokes the refresh token. Idempotent — an already-invalid token
// still returns ok so clients can clear local state unconditionally.
auth.post("/auth/logout", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = refreshSchema.safeParse(body);
  if (parsed.success) await revokeRefreshToken(parsed.data.refreshToken);
  return c.json({ ok: true });
});

export { auth as authRoute };
