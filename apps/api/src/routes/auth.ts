import { createHash } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import {
  issueAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyCredentials,
  checkUserPassword,
  registerEmail,
  rotateVerificationToken,
  provisionGoogleUser,
  createPasswordResetToken,
  type IssuedRefreshToken,
  type RegisterEmailResult,
} from "@amarnai/auth";
import { throttleOnce } from "../services/rate-limit.js";
import {
  fetchGmailProfile,
  fetchGoogleUserInfo,
  parseGrantedScopes,
  exchangeServerAuthCode,
  exchangeAuthCode,
  type GoogleUserInfo,
} from "@amarnai/gmail";
import { RegisterEmailSchema } from "@amarnai/shared";
import { isSupportedLocale, localeFromAcceptLanguage } from "@amarnai/i18n";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountExistsEmail,
  sendGoogleAccountEmail,
} from "@amarnai/email";
import { db, deleteUserCascade, maybeCreateExtensionNudge } from "@amarnai/db";
import { cancelSubscriptionsForAccountDeletion } from "@amarnai/billing";
import type { AppEnv } from "../env.js";
import { syncInboxQueue } from "../services/queue-client.js";
import { disconnectGmail } from "../services/gmail-disconnect.js";
import { registerGmailWatch } from "../services/gmail-watch.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

// Native clients run Google Sign-In with offlineAccess against the Web client and
// send the resulting one-time serverAuthCode here. The API redeems it server-side
// with the Web client secret, yielding a server-refreshable refresh token.
//
// The browser extension runs the OAuth code flow via chrome.identity and its code
// must be redeemed against the redirect URI it was minted for
// (https://<extension-id>.chromiumapp.org/). When `redirectUri` is present the
// code is redeemed with it; when absent the mobile server-auth-code path is used.
const googleSchema = z.object({
  serverAuthCode: z.string().min(1),
  scope: z.string().min(1),
  redirectUri: z.string().url().optional(),
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

// Issues an access token stamped with the user's CURRENT session epoch, so the
// bearer middleware can reject it after a later epoch bump (password reset /
// pre-hijack invalidation) instead of trusting it for the full 15m TTL.
//
// A mint must stamp the EXACT epoch or fail — never a fallback. A read that
// returns null (replica lag, or a race with account deletion) previously stamped
// epoch 0, minting a token the bearer check then rejects for its whole TTL. We
// throw instead so the caller returns a retryable error rather than a
// dead-on-arrival token. Used by /auth/login and /auth/google, where a throw is a
// safe 500-and-retry (nothing was consumed yet). /auth/refresh does NOT use this:
// it mints from the epoch rotateRefreshToken reads in its own transaction, so a
// failed read can never throw after the single-use refresh token was consumed.
async function issueAccessTokenForUser(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { sessionEpoch: true },
  });
  if (!user) {
    throw new Error(`cannot mint access token: user ${userId} not found`);
  }
  return issueAccessToken(userId, user.sessionEpoch);
}

async function issueTokenPair(userId: string): Promise<TokenPair> {
  const [accessToken, refresh] = await Promise.all([
    issueAccessTokenForUser(userId),
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

// Notice emails ("you already have an account" / "sign in with Google") are
// throttled per recipient for this long, so a verified account cannot be
// notice-bombed by repeated registration attempts (beyond the per-IP limit).
const NOTICE_EMAIL_THROTTLE_SECONDS = 15 * 60;

// Hash the recipient before using it as a throttle key so no raw address lands in
// Redis. Not a security boundary, just PII hygiene.
function emailThrottleKey(email: string): string {
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return `register-notice:${hash}`;
}

// Sends the email that matches the registration outcome. The verification link is
// already throttled at issuance (null token when throttled); notice emails are
// throttled per recipient here. Kept separate so the route can fire it and return
// without waiting on delivery.
async function dispatchRegisterEmail(email: string, result: RegisterEmailResult): Promise<void> {
  if (result.status === "verify") {
    if (result.verificationToken) {
      await sendVerificationEmail(email, result.verificationToken);
    }
    return;
  }
  if (!(await throttleOnce(emailThrottleKey(email), NOTICE_EMAIL_THROTTLE_SECONDS))) {
    return;
  }
  if (result.status === "already_registered") {
    await sendAccountExistsEmail(email);
  } else {
    await sendGoogleAccountEmail(email);
  }
}

// Email-first sign-up. Collects only an email; the password is set later at the
// verify step by whoever proves they own the mailbox. Returns the SAME neutral
// { ok: true } for every account state so the response never reveals whether the
// email is registered (no enumeration oracle), and never hands back a session.
// The right guidance is delivered by email, which only the real owner receives.
auth.post("/auth/register", async (c) => {
  const body = await c.req.json().catch(() => null);
  // Non-strict parse: legacy/native bodies may still include `password`; it is
  // ignored under the email-first flow.
  const parsed = RegisterEmailSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message ?? "Invalid request" }, 400);
  }

  const { email } = parsed.data;
  const result = await registerEmail({ email });

  // Dispatch the state-appropriate email fire-and-forget: the response returns
  // immediately so its latency does not vary with account state (shrinking the
  // enumeration timing oracle). A delivery failure never changes the response or
  // leaks state, and the recipient address is never logged.
  void dispatchRegisterEmail(email, result).catch((err) =>
    console.error("[auth/register] send:", err instanceof Error ? err.message : err)
  );

  return c.json({ ok: true });
});

// Requests a password-reset email for native clients. Always returns 200 — it
// never reveals whether an account exists. The shared createPasswordResetToken
// returns null (no mail) for missing/Google-only/throttled accounts. The emailed
// link points at the web /reset-password page (same as the web forgot flow), so
// there is no in-app reset screen to maintain.
auth.post("/auth/forgot-password", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  const token = await createPasswordResetToken(parsed.data.email);
  if (token) {
    // Best-effort: a delivery failure must not turn into an account-existence
    // oracle. Never logs the recipient address.
    await sendPasswordResetEmail(parsed.data.email, token).catch((err) =>
      console.error("[auth/forgot-password] send_reset:", err instanceof Error ? err.message : err)
    );
  }

  return c.json({ ok: true });
});

// Google sign-in for native clients. The mobile app exchanges the auth code
// on-device (Android public client + PKCE) and sends the resulting tokens here
// for user provisioning and Gmail connection storage.
auth.post("/auth/google", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = googleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  const { serverAuthCode, scope, redirectUri } = parsed.data;

  // Early check on the client-claimed scope to avoid redeeming a code that did
  // not include read access. The authoritative scope check is on tokens.scope below.
  if (!parseGrantedScopes(scope).hasReadonly) {
    return c.json({ error: "Gmail read access was not granted" }, 403);
  }

  // Redeem the code with the confidential Web client. The resulting refresh token
  // is server-refreshable (unlike an on-device Android token). Extension codes
  // carry the chromiumapp.org redirect they were minted for; mobile server-auth
  // codes have no redirect (redeemed against the webClientId directly).
  let accessToken: string;
  let refreshToken: string;
  let grantedScope: string;
  try {
    ({ accessToken, refreshToken, scope: grantedScope } = redirectUri
      ? await exchangeAuthCode(serverAuthCode, redirectUri)
      : await exchangeServerAuthCode(serverAuthCode));
  } catch (err) {
    console.error("[auth/google] exchange:", err instanceof Error ? err.message : err);
    return c.json({ error: "Could not complete Google sign-in" }, 502);
  }

  // Store the scopes Google actually granted, not what the client claimed.
  const { scopes: grantedScopes, hasReadonly } = parseGrantedScopes(grantedScope);
  if (!hasReadonly) {
    return c.json({ error: "Gmail read access was not granted" }, 403);
  }

  let email: string;
  try {
    email = (await fetchGmailProfile(accessToken)).emailAddress;
  } catch {
    return c.json({ error: "Could not read Gmail profile" }, 502);
  }

  // Best-effort: requires openid + profile scopes. Missing fields are fine —
  // provisionGoogleUser treats name/imageUrl as optional.
  const userInfo = await fetchGoogleUserInfo(accessToken).catch(() => ({} as GoogleUserInfo));

  const result = await provisionGoogleUser({
    email,
    ...(userInfo.name !== undefined ? { name: userInfo.name } : {}),
    ...(userInfo.picture !== undefined ? { imageUrl: userInfo.picture } : {}),
    gmailAccessToken: accessToken,
    gmailRefreshToken: refreshToken,
    grantedScopes,
    // Seed the default workspace language from the caller's device locale.
    locale: localeFromAcceptLanguage(c.req.header("accept-language")),
  });

  // First-time sign-up: kick off an immediate inbox sync and arm the Gmail push
  // watch (both fire-and-forget; polling and the worker's daily renewal are the
  // fallbacks). Same dedup id as the trigger-sync route so a concurrent webhook
  // does not double-queue. Mirrors the web next-auth new-signup flow.
  if (result.isNew && result.gmailConnected && result.workspaceId) {
    const { workspaceId } = result;
    syncInboxQueue
      .add(
        "sync-inbox",
        { workspaceId },
        { deduplication: { id: `sync-inbox_${workspaceId}` } }
      )
      .catch((err) =>
        console.error("[auth/google] trigger_sync:", err instanceof Error ? err.message : err)
      );
    registerGmailWatch(workspaceId).catch((err) =>
      console.error("[auth/google] register_watch:", err instanceof Error ? err.message : err)
    );
  }

  // Fire-and-forget: one-time "install the browser extension" nudge, for new and
  // returning users alike (the helper is idempotent and self-suppressing). No-op
  // when the sign-in came through the extension itself — it registers on load.
  if (result.gmailConnected && result.workspaceId) {
    maybeCreateExtensionNudge({ userId: result.userId, workspaceId: result.workspaceId }).catch(
      (err) => console.error("[auth/google] extension_nudge:", err instanceof Error ? err.message : err)
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

  // Mint from the epoch rotateRefreshToken already read in its transaction — no
  // second DB read here. A read that failed AFTER the single-use parent was
  // consumed used to throw and burn the client's session (the parent is gone, the
  // child never reached them); minting from the rotation result removes that
  // window entirely.
  const accessToken = await issueAccessToken(rotated.userId, rotated.sessionEpoch);
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

// Shared shape for the "me" endpoints so GET and PATCH never drift.
const ME_SELECT = {
  id: true,
  email: true,
  name: true,
  emailVerified: true,
  lifecycleEmailsEnabled: true,
  // Presence only (never the hash): lets clients decide whether to prompt for a
  // password on sensitive actions like account deletion.
  credential: { select: { userId: true } },
  locale: true,
} as const;

function toMeResponse(user: {
  id: string;
  email: string;
  name: string | null;
  emailVerified: Date | null;
  lifecycleEmailsEnabled: boolean;
  credential: { userId: string } | null;
  locale: string;
}) {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified !== null,
    lifecycleEmailsEnabled: user.lifecycleEmailsEnabled,
    hasPassword: user.credential != null,
    locale: user.locale,
  };
}

// Authenticated identity for the current access token. There is no other "me"
// endpoint; native clients use this to resolve the signed-in user and to read
// emailVerified for the post-sign-up verification gate.
auth.get("/auth/me", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const user = await db.user.findUnique({ where: { id: userId }, select: ME_SELECT });
  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json(toMeResponse(user));
});

// Update the authenticated user's profile/preferences. Partial: only the fields
// present in the body are changed, so a client can toggle one setting without
// clobbering the others.
auth.patch("/auth/me", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Invalid body" }, 400);

  const data: { name?: string | null; lifecycleEmailsEnabled?: boolean; locale?: string } = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length > 100) return c.json({ error: "Name must be 100 characters or fewer" }, 400);
    data.name = name || null;
  }

  if ("lifecycleEmailsEnabled" in body) {
    if (typeof body.lifecycleEmailsEnabled !== "boolean") {
      return c.json({ error: "lifecycleEmailsEnabled must be a boolean" }, 400);
    }
    data.lifecycleEmailsEnabled = body.lifecycleEmailsEnabled;
  }

  if ("locale" in body) {
    if (!isSupportedLocale(body.locale)) {
      return c.json({ error: "Unsupported locale" }, 400);
    }
    data.locale = body.locale;
  }

  const user = await db.user.update({ where: { id: userId }, data, select: ME_SELECT });

  return c.json(toMeResponse(user));
});

// Permanently delete the authenticated user's account and all owned data.
// Disconnects all Gmail connections (best-effort) before wiping rows.
auth.delete("/auth/me", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  // Step-up re-authentication: password accounts must re-enter their password
  // before this irreversible action. Federated (Google-only) accounts have no
  // password to verify ("no_password") and proceed on their valid access token.
  const body = (await c.req.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if ((await checkUserPassword(userId, password)) === "wrong") {
    return c.json({ error: "Incorrect password" }, 401);
  }

  const ownedWorkspaces = await db.workspace.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });

  for (const { id: workspaceId } of ownedWorkspaces) {
    const connection = await db.emailConnection.findUnique({ where: { workspaceId }, select: { id: true } });
    if (connection) {
      try {
        await disconnectGmail(workspaceId, { eraseData: false, actorUserId: userId });
      } catch (err) {
        console.warn(
          `[delete-account] Gmail disconnect failed for workspace ${workspaceId} (non-fatal):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Cancel any paid Stripe subscriptions before the workspace rows are gone, so a
  // deleted account can never keep paying. Never throws; a Stripe failure records a
  // durable retry row the worker reconciles.
  await cancelSubscriptionsForAccountDeletion(userId);

  await deleteUserCascade(userId);
  return c.json({ ok: true });
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
