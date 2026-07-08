import {
  OUTLOOK_SCOPES,
  MicrosoftApiError,
  exchangeAuthCode,
  fetchOutlookProfile,
  fetchSubjectId,
} from "@amarnai/outlook";
import type { OutlookProfile, OutlookTokens } from "@amarnai/outlook";

// HTTP helpers (token exchange, profile, subject id) live in @amarnai/outlook so
// the API can share them, mirroring how @/lib/gmail-oauth re-exports @amarnai/gmail.
// State signing (generateState/verifyState) is provider-neutral and reused from
// @/lib/gmail-oauth — do not duplicate it here.
export { MicrosoftApiError, fetchOutlookProfile, fetchSubjectId };
export type { OutlookProfile, OutlookTokens };

/**
 * Whether the Outlook provider is configured (a full confidential-client
 * credential pair). Server-only — gates whether the connect UI offers Outlook,
 * mirroring config.outlook.enabled without pulling @amarnai/config into the web
 * build (which would force these env vars to be present at build time).
 */
export function isOutlookConfigured(): boolean {
  return Boolean(env("MS_GRAPH_CLIENT_ID") && env("MS_GRAPH_CLIENT_SECRET"));
}

// Read an env var, treating an empty/whitespace-only value as unset. `??` alone
// would pass through OUTLOOK_OAUTH_CALLBACK_URL="" and send an empty redirect_uri,
// which Microsoft rejects with "AADSTS900971: No reply address provided".
function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const MS_TENANT = env("MS_GRAPH_TENANT") ?? "common";
const MS_AUTH_URL = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize`;

function getCallbackUrl(): string {
  return env("OUTLOOK_OAUTH_CALLBACK_URL") ?? "http://localhost:3000/api/outlook/callback";
}

// ─── OAuth URL ────────────────────────────────────────────────────────────────
// Requests Mail.Read + offline_access + User.Read — the read-only minimum that
// mirrors gmail.readonly. offline_access is required for a refresh token.

export function buildOutlookAuthUrl(state: string): string {
  const clientId = env("MS_GRAPH_CLIENT_ID");
  if (!clientId) {
    // Guard rather than send client_id="", which Microsoft rejects with an
    // opaque error. isOutlookConfigured() should gate the connect UI upstream.
    throw new Error("MS_GRAPH_CLIENT_ID is not configured");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getCallbackUrl(),
    response_type: "code",
    response_mode: "query",
    scope: OUTLOOK_SCOPES,
    state,
  });
  return `${MS_AUTH_URL}?${params.toString()}`;
}

// ─── Token exchange (web callback) ──────────────────────────────────────────────
// Thin wrapper that pins the redirect URI to the web callback so call sites keep
// a single-argument signature, matching exchangeCodeForTokens in gmail-oauth.

export function exchangeCodeForTokens(code: string): Promise<OutlookTokens> {
  return exchangeAuthCode(code, getCallbackUrl());
}
