// Google OAuth HTTP helpers shared by the web app (browser redirect flow) and
// the API (native-client PKCE flow). Web-specific concerns — OAuth state signing
// and the consent-URL builder — stay in apps/web/src/lib/gmail-oauth.ts.
import type { GmailProfile } from "./gmail-client.js";

// The minimum Gmail scope for the triage MVP. Single source of truth, shared by
// the web OAuth flow, the API, and provisioning. Will expand to modify/send when
// compose/send ship.
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// Parses a space-delimited OAuth scope string and confirms gmail.readonly was
// granted. Shared by every sign-in/connect path so the read-access requirement
// is enforced identically. Returns the parsed scopes for storing on the record.
export function parseGrantedScopes(scope: string): { scopes: string[]; hasReadonly: boolean } {
  const scopes = scope.split(" ");
  return { scopes, hasReadonly: scopes.includes(GMAIL_READONLY_SCOPE) };
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// v1 tokeninfo is used (not v3) because v3 uses `sub` which is only reliably
// populated for ID tokens. v1 returns `user_id` for any valid access token.
const GOOGLE_TOKENINFO_V1_URL = "https://www.googleapis.com/oauth2/v1/tokeninfo";
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

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
  console.error(`[google-oauth] ${label} status=${status}${extra}`);
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export type GmailTokens = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
};

// Exchanges an authorization code for tokens. `redirectUri` must match the one
// used to obtain the code (web callback URL or the native client's redirect).
// `codeVerifier` is supplied by PKCE clients; omit it for the web flow.
//
// Only the web flow exchanges codes server-side. Native (mobile) clients are
// public OAuth clients and must exchange on-device — Google returns
// unauthorized_client for server-side exchange against an Android/iOS client.
export async function exchangeAuthCode(
  code: string,
  redirectUri: string,
  codeVerifier?: string
): Promise<GmailTokens> {
  const params: Record<string, string> = {
    code,
    client_id: process.env["AUTH_GOOGLE_ID"] ?? "",
    client_secret: process.env["AUTH_GOOGLE_SECRET"] ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };
  if (codeVerifier) params["code_verifier"] = codeVerifier;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  if (!res.ok) {
    // Google's token error body contains error codes like "invalid_grant",
    // "redirect_uri_mismatch" — never tokens or secrets.
    type ErrorBody = { error?: string; error_description?: string };
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    // Log both the error code and description so the reason is visible in dev logs.
    const detail = body.error_description ? ` — ${body.error_description}` : "";
    devLog("token_exchange", res.status, `${body.error ?? "unknown"}${detail}`);
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
    // The auth URL uses prompt=consent to prevent this, but revoking app access
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

// ─── Server auth code exchange (mobile) ─────────────────────────────────────────
// The mobile app runs Google Sign-In with offlineAccess against the Web client
// and receives a one-time serverAuthCode. The API redeems it here with the Web
// client id + secret. There is no redirect URI (the code was minted for the
// webClientId, not a redirect flow), so redirect_uri is empty. The resulting
// refresh token is bound to the confidential Web client and is server-refreshable.
export function exchangeServerAuthCode(serverAuthCode: string): Promise<GmailTokens> {
  return exchangeAuthCode(serverAuthCode, "");
}

// ─── Gmail profile ────────────────────────────────────────────────────────────
// Fetches the inbox profile with a raw access token. Used during connection
// setup to verify the token actually has Gmail API access before storing it.

export async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const res = await fetch(GMAIL_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Google Gmail API errors use { error: { status, message } } shape.
    type ErrorBody = { error?: { status?: string; message?: string } };
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    const googleError = body.error?.status ?? body.error?.message;
    devLog("gmail_profile", res.status, googleError);
    throw new GmailApiError(`Gmail profile fetch failed: ${res.status}`, res.status, googleError);
  }
  return res.json() as Promise<GmailProfile>;
}

// ─── Google subject ID via tokeninfo ─────────────────────────────────────────
// The OIDC userinfo endpoint requires the `openid` scope, which a
// gmail.readonly-only token does not carry. The tokeninfo endpoint works with
// any valid Google OAuth access token and returns the stable account ID without
// additional scopes. Server-side only; the token never appears in URLs or logs.

export async function fetchGoogleSubjectId(accessToken: string): Promise<string> {
  const url = new URL(GOOGLE_TOKENINFO_V1_URL);
  url.searchParams.set("access_token", accessToken);
  // Do not log `url` — it contains the access token in the query string.
  const res = await fetch(url.toString());
  if (!res.ok) {
    type ErrorBody = { error?: string; error_description?: string };
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    devLog("google_tokeninfo", res.status, body.error);
    throw new GmailApiError(`Google tokeninfo failed: ${res.status}`, res.status, body.error);
  }
  // v1 tokeninfo returns `user_id`, not `sub`.
  const data = (await res.json()) as { user_id?: string };
  if (!data.user_id) throw new Error("Missing user_id in tokeninfo response");
  return data.user_id;
}

// ─── OIDC user info ───────────────────────────────────────────────────────────
// Requires the `openid profile` scopes. Callers that only hold gmail.readonly
// should catch GmailApiError and treat name/picture as optional.

export type GoogleUserInfo = {
  name?: string;
  picture?: string;
};

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    type ErrorBody = { error?: string; error_description?: string };
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    devLog("google_userinfo", res.status, body.error);
    throw new GmailApiError(`Google userinfo failed: ${res.status}`, res.status, body.error);
  }
  const data = (await res.json()) as { name?: string; picture?: string };
  const info: GoogleUserInfo = {};
  if (data.name !== undefined) info.name = data.name;
  if (data.picture !== undefined) info.picture = data.picture;
  return info;
}
