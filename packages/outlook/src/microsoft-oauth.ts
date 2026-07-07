// Microsoft identity platform OAuth HTTP helpers for the read-only Outlook
// integration, mirroring packages/gmail/src/google-oauth.ts. Web-specific
// concerns (state signing, consent-URL builder) live in the web app.
//
// Confidential Web app registration, multitenant + personal accounts, so the
// authority is `/common`. Delegated scopes only — no admin consent required.

/** Minimum Graph scope to read mail (read-only, mirrors gmail.readonly). */
export const OUTLOOK_MAIL_READ_SCOPE = "Mail.Read";

/**
 * Full delegated scope set requested at consent. `offline_access` is required for
 * a refresh token; `User.Read` gives `/me` for the account identity.
 */
export const OUTLOOK_SCOPES = "Mail.Read offline_access User.Read";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

function tenant(): string {
  return process.env["MS_GRAPH_TENANT"] || "common";
}

function tokenUrl(): string {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
}

function clientCredentials(): { client_id: string; client_secret: string } {
  return {
    client_id: process.env["MS_GRAPH_CLIENT_ID"] ?? "",
    client_secret: process.env["MS_GRAPH_CLIENT_SECRET"] ?? "",
  };
}

// ─── Scope parsing ──────────────────────────────────────────────────────────

// Microsoft echoes granted scopes without the resource prefix (e.g. "Mail.Read"),
// and matches case-insensitively. Confirms mail read access was granted, and
// returns the parsed scopes for storing on the connection row.
export function parseGrantedScopes(scope: string): { scopes: string[]; hasReadonly: boolean } {
  const scopes = scope.split(" ").filter(Boolean);
  const hasReadonly = scopes.some(
    (s) => s.toLowerCase() === OUTLOOK_MAIL_READ_SCOPE.toLowerCase(),
  );
  return { scopes, hasReadonly };
}

// ─── Error class ────────────────────────────────────────────────────────────

export class MicrosoftApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly graphError?: string,
  ) {
    super(message);
    this.name = "MicrosoftApiError";
  }
}

// ─── Dev-only sanitized logging ───────────────────────────────────────────────
// Never logs tokens, codes, or raw payloads — only HTTP status and Microsoft's
// own error code strings (e.g. "invalid_grant", "AADSTS...").

function devLog(label: string, status: number, graphError?: string): void {
  if (process.env["NODE_ENV"] === "production") return;
  const extra = graphError ? ` graph_error="${graphError}"` : "";
  console.error(`[microsoft-oauth] ${label} status=${status}${extra}`);
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export type OutlookTokens = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
};

/**
 * Exchanges an authorization code for tokens. `redirectUri` must match the one
 * used to obtain the code. `codeVerifier` is supplied by PKCE clients; omit it
 * for the confidential Web flow (which uses the client secret).
 */
export async function exchangeAuthCode(
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<OutlookTokens> {
  const params: Record<string, string> = {
    code,
    ...clientCredentials(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    // Re-request the delegated scopes so the refresh token carries them.
    scope: OUTLOOK_SCOPES,
  };
  if (codeVerifier) params["code_verifier"] = codeVerifier;

  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  if (!res.ok) {
    type ErrorBody = { error?: string; error_description?: string };
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    const detail = body.error_description ? ` — ${body.error_description}` : "";
    devLog("token_exchange", res.status, `${body.error ?? "unknown"}${detail}`);
    throw new MicrosoftApiError(`Token exchange failed: ${res.status}`, res.status, body.error);
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
    // Missing when offline_access was not granted, or on a silent re-consent.
    throw new Error("No refresh_token — ensure offline_access is requested and reconnect");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    scope: data.scope,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ─── Profile / identity ───────────────────────────────────────────────────────

export type OutlookProfile = {
  /** The mailbox address (`mail`, falling back to `userPrincipalName`). */
  emailAddress: string;
  /** Stable Entra object id — the durable `providerAccountId` for Outlook. */
  subjectId: string;
};

/**
 * Fetches the connected account's identity with a raw access token. Used during
 * connection setup to verify the token has Graph access before storing it. `mail`
 * is null for some personal accounts, so `userPrincipalName` is the fallback.
 */
export async function fetchOutlookProfile(accessToken: string): Promise<OutlookProfile> {
  const url = `${GRAPH_BASE_URL}/me?$select=id,mail,userPrincipalName`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    type ErrorBody = { error?: { code?: string; message?: string } };
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    const graphError = body.error?.code ?? body.error?.message;
    devLog("graph_me", res.status, graphError);
    throw new MicrosoftApiError(`Graph /me fetch failed: ${res.status}`, res.status, graphError);
  }
  const data = (await res.json()) as { id?: string; mail?: string | null; userPrincipalName?: string };
  const emailAddress = (data.mail ?? data.userPrincipalName ?? "").toLowerCase();
  if (!emailAddress) throw new Error("Graph /me returned no mail or userPrincipalName");
  if (!data.id) throw new Error("Graph /me returned no id");
  return { emailAddress, subjectId: data.id };
}

/** The stable Entra object id for the token's account (the `providerAccountId`). */
export async function fetchSubjectId(accessToken: string): Promise<string> {
  const { subjectId } = await fetchOutlookProfile(accessToken);
  return subjectId;
}
