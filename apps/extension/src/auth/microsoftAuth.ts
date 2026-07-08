import { MS_CLIENT_ID } from "../config";
import { ext } from "../platform/ext";

// Delegated scopes for the read-only Outlook connection. Mirrors
// @amarnai/outlook OUTLOOK_SCOPES (kept as a literal so the extension bundle does
// not pull the Graph client). offline_access is required for a refresh token;
// User.Read backs the Graph /me identity lookup.
const SCOPES = "Mail.Read offline_access User.Read";

// Multitenant + personal accounts, so the authority is /common (mirrors the web
// buildOutlookAuthUrl and the API's confidential Web client).
const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

export class MicrosoftAuthCancelledError extends Error {
  constructor() {
    super("Microsoft sign-in was cancelled");
    this.name = "MicrosoftAuthCancelledError";
  }
}

export interface MicrosoftAuthResult {
  code: string;
  scope: string;
  redirectUri: string;
}

// Runs the Microsoft OAuth *code* flow via identity.launchWebAuthFlow and returns
// the authorization code for the API to redeem. The code must be redeemed against
// this exact redirect URI (Chrome: https://<ext-id>.chromiumapp.org/, Firefox:
// https://<hash>.extensions.allizom.org/), which the API receives alongside the
// code and pins on exchangeAuthCode — so the redirect must be registered on the
// Microsoft app registration. Unlike Google, Microsoft returns a refresh token
// whenever offline_access is granted, so no forced consent prompt is needed;
// prompt=select_account lets the user pick which mailbox to connect.
export async function requestMicrosoftAuth(): Promise<MicrosoftAuthResult> {
  if (!MS_CLIENT_ID) {
    throw new Error("VITE_MS_CLIENT_ID is not configured");
  }

  const redirectUri = ext.identity.getRedirectURL();
  const authUrl =
    `${AUTHORIZE_URL}?` +
    new URLSearchParams({
      client_id: MS_CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: SCOPES,
      prompt: "select_account",
    }).toString();

  let resultUrl: string | undefined;
  try {
    resultUrl = await ext.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch {
    // Both browsers reject (or resolve undefined) when the user closes the window.
    throw new MicrosoftAuthCancelledError();
  }
  if (!resultUrl) throw new MicrosoftAuthCancelledError();

  const params = new URL(resultUrl).searchParams;
  const code = params.get("code");
  if (!code) {
    // error=access_denied when the user declines consent.
    throw new MicrosoftAuthCancelledError();
  }

  return {
    code,
    // Microsoft echoes the granted scopes; fall back to what we requested.
    scope: params.get("scope") ?? SCOPES,
    redirectUri,
  };
}
