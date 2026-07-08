import { GOOGLE_WEB_CLIENT_ID } from "../config";
import { runAuthCodeFlow } from "./authCodeFlow";

// Scopes requested for Google sign-in. gmail.readonly is the triage scope
// (single source of truth server-side); openid+email+profile let the API read
// the account email and name.
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

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

// Runs the Google OAuth *code* flow and returns the authorization code for the API
// to redeem. The code must be redeemed against the returned redirect URI, which is
// why we send it to /auth/google alongside the code.
//
// prompt=consent + access_type=offline are mandatory: Google only returns a
// refresh token when it (re)shows consent, and the API's exchangeAuthCode throws
// if the token response carries no refresh token. Returning users therefore see
// the consent screen on each sign-in — accepted MVP behavior.
export async function requestGoogleAuth(): Promise<GoogleAuthResult> {
  // Google returns the code as `code`; the API's /auth/google contract names it
  // `serverAuthCode`, so rename it here.
  const { code, scope, redirectUri } = await runAuthCodeFlow({
    authorizeUrl: AUTHORIZE_URL,
    clientId: GOOGLE_WEB_CLIENT_ID,
    missingClientIdMessage: "VITE_GOOGLE_WEB_CLIENT_ID is not configured",
    scope: SCOPES,
    extraParams: { access_type: "offline", prompt: "consent" },
    onCancel: () => new GoogleAuthCancelledError(),
  });
  return { serverAuthCode: code, scope, redirectUri };
}
