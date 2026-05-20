import crypto from "crypto";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// v1 tokeninfo is used (not v3) because v3 uses `sub` which is only reliably
// populated for ID tokens. v1 returns `user_id` for any valid access token.
const GOOGLE_TOKENINFO_V1_URL = "https://www.googleapis.com/oauth2/v1/tokeninfo";
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GMAIL_THREADS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";

function getCallbackUrl(): string {
  return process.env["GMAIL_OAUTH_CALLBACK_URL"] ?? "http://localhost:3000/api/gmail/callback";
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class GmailApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly googleError?: string
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

// ─── Dev-only sanitized logging ───────────────────────────────────────────────
// Never logs tokens, codes, or raw OAuth payloads — only HTTP status and
// Google's own error code strings (e.g. "invalid_grant", "PERMISSION_DENIED").

function devLog(label: string, status: number, googleError?: string): void {
  if (process.env["NODE_ENV"] === "production") return;
  const extra = googleError ? ` google_error="${googleError}"` : "";
  console.error(`[gmail-oauth] ${label} status=${status}${extra}`);
}

// ─── State signing ────────────────────────────────────────────────────────────

type OAuthState = {
  workspaceId: string;
  userId: string;
  nonce: string;
  ts: number;
};

function signState(payload: OAuthState): string {
  const secret = process.env["AUTH_SECRET"] ?? "";
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString("base64url");
}

export function generateState(workspaceId: string, userId: string): string {
  return signState({
    workspaceId,
    userId,
    nonce: crypto.randomBytes(16).toString("hex"),
    ts: Date.now(),
  });
}

export function verifyState(
  encoded: string,
  expectedUserId: string,
  expectedWorkspaceId: string
): OAuthState {
  let parsed: OAuthState & { sig: string };
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState & {
      sig: string;
    };
  } catch {
    throw new Error("Invalid OAuth state");
  }

  const { sig, ...payload } = parsed;
  const secret = process.env["AUTH_SECRET"] ?? "";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
    throw new Error("OAuth state signature mismatch");
  }

  if (Date.now() - payload.ts > 10 * 60 * 1000) {
    throw new Error("OAuth state expired");
  }

  if (payload.userId !== expectedUserId) {
    throw new Error("OAuth state user mismatch");
  }

  if (payload.workspaceId !== expectedWorkspaceId) {
    throw new Error("OAuth state workspace mismatch");
  }

  return payload;
}

// ─── OAuth URL ────────────────────────────────────────────────────────────────
// Requests only gmail.readonly — no modify, compose, send, or label scopes.

export function buildGmailAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env["AUTH_GOOGLE_ID"] ?? "",
    redirect_uri: getCallbackUrl(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export type GmailTokens = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
};

export async function exchangeCodeForTokens(code: string): Promise<GmailTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env["AUTH_GOOGLE_ID"] ?? "",
      client_secret: process.env["AUTH_GOOGLE_SECRET"] ?? "",
      redirect_uri: getCallbackUrl(),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    // Google's token error body contains error codes like "invalid_grant",
    // "redirect_uri_mismatch" — never tokens or secrets.
    type ErrorBody = { error?: string; error_description?: string };
    const body = await res.json().catch(() => ({})) as ErrorBody;
    devLog("token_exchange", res.status, body.error);
    throw new GmailApiError(`Token exchange failed: ${res.status}`, res.status, body.error);
  }

  type TokenResponse = {
    access_token: string;
    refresh_token?: string;
    scope: string;
    expires_in: number;
  };
  const data = (await res.json()) as TokenResponse;

  if (!data.access_token) throw new Error("No access_token in token response");
  if (!data.refresh_token) {
    // Happens when the user previously granted access and Google skipped consent.
    // The connect URL uses prompt=consent to prevent this, but revoking app access
    // at myaccount.google.com/permissions and reconnecting will fix it.
    throw new Error("No refresh_token — revoke app access and reconnect to force consent");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    scope: data.scope,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ─── Gmail profile ────────────────────────────────────────────────────────────

export type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};

export async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const res = await fetch(GMAIL_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Google Gmail API errors use { error: { status, message } } shape.
    type ErrorBody = { error?: { status?: string; message?: string } };
    const body = await res.json().catch(() => ({})) as ErrorBody;
    const googleError = body.error?.status ?? body.error?.message;
    devLog("gmail_profile", res.status, googleError);
    throw new GmailApiError(`Gmail profile fetch failed: ${res.status}`, res.status, googleError);
  }
  return res.json() as Promise<GmailProfile>;
}

// ─── Google subject ID via tokeninfo ─────────────────────────────────────────
// The OIDC userinfo endpoint (openidconnect.googleapis.com/v1/userinfo) requires
// the `openid` scope, which our gmail.readonly-only token does not carry.
// The tokeninfo endpoint works with any valid Google OAuth access token and
// returns the `sub` (stable Google account ID) without additional scopes.
// This is a server-side call only; the token never appears in browser URLs or logs.

export async function fetchGoogleSubjectId(accessToken: string): Promise<string> {
  const url = new URL(GOOGLE_TOKENINFO_V1_URL);
  url.searchParams.set("access_token", accessToken);
  // Do not log `url` — it contains the access token in the query string.
  const res = await fetch(url.toString());
  if (!res.ok) {
    type ErrorBody = { error?: string; error_description?: string };
    const body = await res.json().catch(() => ({})) as ErrorBody;
    devLog("google_tokeninfo", res.status, body.error);
    throw new GmailApiError(
      `Google tokeninfo failed: ${res.status}`,
      res.status,
      body.error
    );
  }
  // v1 tokeninfo returns `user_id`, not `sub`.
  const data = (await res.json()) as { user_id?: string };
  if (!data.user_id) throw new Error("Missing user_id in tokeninfo response");
  return data.user_id;
}

// ─── List recent thread IDs ───────────────────────────────────────────────────

export async function listRecentGmailThreadIds(
  accessToken: string,
  maxResults = 10
): Promise<string[]> {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  const res = await fetch(`${GMAIL_THREADS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    type ErrorBody = { error?: { status?: string; message?: string } };
    const body = await res.json().catch(() => ({})) as ErrorBody;
    const googleError = body.error?.status ?? body.error?.message;
    devLog("gmail_threads", res.status, googleError);
    throw new GmailApiError(`Gmail threads list failed: ${res.status}`, res.status, googleError);
  }
  type ThreadList = { threads?: Array<{ id: string }> };
  const data = (await res.json()) as ThreadList;
  return (data.threads ?? []).map((t) => t.id);
}
