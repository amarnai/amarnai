import { GOOGLE_WEB_CLIENT_ID } from "../config";
import { ext } from "../platform/ext";

// Scopes requested for Google sign-in. gmail.readonly is the triage scope
// (single source of truth server-side); openid+email+profile let the API read
// the account email and name.
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

export class GoogleAuthCancelledError extends Error {
  constructor() {
    super("Google sign-in was cancelled");
    this.name = "GoogleAuthCancelledError";
  }
}

export interface GoogleAuthResult {
  serverAuthCode: string;
  scope: string;
  redirectUri: string;
}

// Runs the Google OAuth *code* flow via identity.launchWebAuthFlow and returns
// the authorization code for the API to redeem. The code must be redeemed against
// this exact redirect URI (Chrome: https://<ext-id>.chromiumapp.org/, Firefox:
// https://<hash>.extensions.allizom.org/), which is why we send it to
// /auth/google alongside the code.
//
// prompt=consent + access_type=offline are mandatory: Google only returns a
// refresh token when it (re)shows consent, and the API's exchangeAuthCode throws
// if the token response carries no refresh token. Returning users therefore see
// the consent screen on each sign-in — accepted MVP behavior.
export async function requestGoogleAuth(): Promise<GoogleAuthResult> {
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error("VITE_GOOGLE_WEB_CLIENT_ID is not configured");
  }

  const redirectUri = ext.identity.getRedirectURL();
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: GOOGLE_WEB_CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
    }).toString();

  let resultUrl: string | undefined;
  try {
    resultUrl = await ext.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch {
    // Both browsers reject (or resolve undefined) when the user closes the window.
    throw new GoogleAuthCancelledError();
  }
  if (!resultUrl) throw new GoogleAuthCancelledError();

  const params = new URL(resultUrl).searchParams;
  const code = params.get("code");
  if (!code) {
    // error=access_denied when the user declines consent.
    throw new GoogleAuthCancelledError();
  }

  return {
    serverAuthCode: code,
    // Google echoes the granted scopes; fall back to what we requested.
    scope: params.get("scope") ?? SCOPES,
    redirectUri,
  };
}
