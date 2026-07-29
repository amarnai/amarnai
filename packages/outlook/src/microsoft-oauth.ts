// Microsoft identity platform OAuth HTTP helpers for the read-only Outlook
// integration, mirroring packages/gmail/src/google-oauth.ts. Web-specific
// concerns (state signing, consent-URL builder) live in the web app.
//
// Confidential Web app registration, multitenant + personal accounts, so the
// authority is `/common`. Delegated scopes only — no admin consent required.

/** Minimum Graph scope to read mail (read-only, mirrors gmail.readonly). */
export const OUTLOOK_MAIL_READ_SCOPE = "Mail.Read";

/**
 * Category writeback needs TWO delegated scopes, and both are required:
 *  - Mail.ReadWrite         → PATCH the `categories` array onto messages.
 *  - MailboxSettings.ReadWrite → list/create the mailbox's master category list
 *    (/me/outlook/masterCategories). Categories are mailbox settings, NOT mail
 *    items, so Mail.ReadWrite alone 403s "ErrorAccessDenied" on that endpoint —
 *    which is exactly the first call ensureFolderLabels makes.
 * Requested only through the writeback flow, never for a read-only connect.
 */
export const OUTLOOK_MAIL_READWRITE_SCOPE = "Mail.ReadWrite";
export const OUTLOOK_MAILBOX_SETTINGS_RW_SCOPE = "MailboxSettings.ReadWrite";

/**
 * Full delegated scope set requested at consent. `offline_access` is required for
 * a refresh token; `User.Read` gives `/me` for the account identity.
 */
export const OUTLOOK_SCOPES = "Mail.Read offline_access User.Read";

/** Scope set for the writeback flow — adds Mail.ReadWrite (message categories)
 *  and MailboxSettings.ReadWrite (master category list). Must match the
 *  authorize request, since Microsoft refresh tokens are scope-bound. */
export const OUTLOOK_WRITEBACK_SCOPES =
  "Mail.ReadWrite MailboxSettings.ReadWrite offline_access User.Read";

/**
 * `openid` makes Microsoft return an id_token alongside the access token, which
 * is where the account's tenant claim (and so whether it is a personal Microsoft
 * account) comes from. It is a sign-in scope: no consent prompt of its own, no
 * admin consent, no data access.
 *
 * Requested at CONSENT time only, never on refresh. A refresh request may only
 * ask for scopes at or below the original grant, so sending `openid` to refresh a
 * connection consented before this existed would be rejected and break its sync.
 * That is why these are separate constants rather than additions to the sets
 * above, which GraphClient refreshes with.
 */
export const OUTLOOK_SIGNIN_SCOPE = "openid";
export const OUTLOOK_CONSENT_SCOPES = `${OUTLOOK_SIGNIN_SCOPE} ${OUTLOOK_SCOPES}`;
export const OUTLOOK_WRITEBACK_CONSENT_SCOPES = `${OUTLOOK_SIGNIN_SCOPE} ${OUTLOOK_WRITEBACK_SCOPES}`;

/**
 * The single tenant every personal Microsoft account (MSA) signs in under, fixed
 * and published by Microsoft. Any other tenant id is a work/school account.
 */
export const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

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
// and matches case-insensitively. `hasReadonly` gates the connect flow (either
// scope satisfies it, since ReadWrite supersedes Read); `hasWriteback` decides
// whether the writeback upgrade succeeded. Returns the parsed scopes for storage.
export function parseGrantedScopes(scope: string): {
  scopes: string[];
  hasReadonly: boolean;
  hasWriteback: boolean;
} {
  const scopes = scope.split(" ").filter(Boolean);
  const hasWriteback = hasWritebackScope(scopes);
  const lower = scopes.map((s) => s.toLowerCase());
  // Mail.ReadWrite (part of the writeback set) supersedes Mail.Read for reads.
  const hasReadonly =
    lower.includes(OUTLOOK_MAIL_READWRITE_SCOPE.toLowerCase()) ||
    lower.includes(OUTLOOK_MAIL_READ_SCOPE.toLowerCase());
  return { scopes, hasReadonly, hasWriteback };
}

// Whether a persisted grantedScopes array carries BOTH write scopes category
// writeback needs (message categories + master category list). Requiring both is
// deliberate: a connection with only Mail.ReadWrite 403s on masterCategories, so
// treating it as "has writeback" would provision-fail forever instead of
// re-prompting for the missing MailboxSettings.ReadWrite. Case-insensitive
// (Microsoft echoes scopes without stable casing).
export function hasWritebackScope(grantedScopes: readonly string[]): boolean {
  const lower = grantedScopes.map((s) => s.toLowerCase());
  return (
    lower.includes(OUTLOOK_MAIL_READWRITE_SCOPE.toLowerCase()) &&
    lower.includes(OUTLOOK_MAILBOX_SETTINGS_RW_SCOPE.toLowerCase())
  );
}

/**
 * The scope set to redeem an authorization code with, given the scope string the
 * client says it authorized against.
 *
 * Microsoft refuses a redemption that asks for more than the authorize request
 * did, so a client build that predates the `openid` sign-in scope has to be
 * redeemed without it — otherwise every already-installed browser extension
 * would fail to connect until it updated. The client's string only selects
 * between two fixed constants here; it is never forwarded to Microsoft verbatim.
 */
export function scopeForCodeRedemption(clientScope: string): string {
  const signedIn = clientScope
    .split(" ")
    .some((s) => s.toLowerCase() === OUTLOOK_SIGNIN_SCOPE);
  return signedIn ? OUTLOOK_CONSENT_SCOPES : OUTLOOK_SCOPES;
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
  /** Personal (MSA) vs work/school, from the id_token's tenant claim. Null when
   *  no id_token came back (the `openid` scope was not part of the consent). */
  accountType: OutlookAccountType | null;
};

/**
 * Mirrors the OutlookAccountType enum in @amarnai/db and the union in
 * @amarnai/core. Redeclared here so this package keeps its two dependencies.
 */
export type OutlookAccountType = "PERSONAL" | "ORGANIZATION";

/**
 * Whether the id_token's account is a personal Microsoft account, from its `tid`
 * (tenant) claim. Returns null when there is no token or no claim.
 *
 * The signature is NOT verified, and deliberately so: this decides which Outlook
 * web host to open, nothing more. Identity still comes from Graph /me, which is
 * bound to the token we redeemed — an unverified claim from the /common
 * authority must never be trusted for who the user is (the nOAuth class of
 * account takeover). Nothing from the token is ever logged.
 */
export function accountTypeFromIdToken(
  idToken: string | null | undefined,
): OutlookAccountType | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
  const tenantId = typeof claims["tid"] === "string" ? claims["tid"] : null;
  if (!tenantId) return null;
  return tenantId.toLowerCase() === MICROSOFT_CONSUMER_TENANT_ID ? "PERSONAL" : "ORGANIZATION";
}

/**
 * Exchanges an authorization code for tokens. `redirectUri` must match the one
 * used to obtain the code. `codeVerifier` is supplied by PKCE clients; omit it
 * for the confidential Web flow (which uses the client secret).
 */
export async function exchangeAuthCode(
  code: string,
  redirectUri: string,
  codeVerifier?: string,
  scope: string = OUTLOOK_CONSENT_SCOPES,
): Promise<OutlookTokens> {
  const params: Record<string, string> = {
    code,
    ...clientCredentials(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    // Re-request the delegated scopes so the refresh token carries them. The
    // writeback upgrade passes OUTLOOK_WRITEBACK_SCOPES here.
    scope,
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
    /** Present when the consent included `openid`; absent otherwise. */
    id_token?: string;
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
    accountType: accountTypeFromIdToken(data.id_token),
  };
}

// ─── Profile / identity ───────────────────────────────────────────────────────

export type OutlookProfile = {
  /** The mailbox address (`mail`, falling back to `userPrincipalName`). */
  emailAddress: string;
  /** Stable Entra object id — the durable `providerAccountId` for Outlook. */
  subjectId: string;
  /** Account display name, used to seed `User.name` on federated sign-in. Null
   *  when the directory has none. No avatar: Graph serves the photo as a binary
   *  we would have to host ourselves, so Microsoft users start without one. */
  displayName: string | null;
};

/**
 * Fetches the connected account's identity with a raw access token. Used during
 * connection setup to verify the token has Graph access before storing it. `mail`
 * is null for some personal accounts, so `userPrincipalName` is the fallback.
 */
export async function fetchOutlookProfile(accessToken: string): Promise<OutlookProfile> {
  const url = `${GRAPH_BASE_URL}/me?$select=id,mail,userPrincipalName,displayName`;
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
  const data = (await res.json()) as {
    id?: string;
    mail?: string | null;
    userPrincipalName?: string;
    displayName?: string | null;
  };
  const emailAddress = (data.mail ?? data.userPrincipalName ?? "").toLowerCase();
  if (!emailAddress) throw new Error("Graph /me returned no mail or userPrincipalName");
  if (!data.id) throw new Error("Graph /me returned no id");
  return { emailAddress, subjectId: data.id, displayName: data.displayName ?? null };
}

/** The stable Entra object id for the token's account (the `providerAccountId`). */
export async function fetchSubjectId(accessToken: string): Promise<string> {
  const { subjectId } = await fetchOutlookProfile(accessToken);
  return subjectId;
}
