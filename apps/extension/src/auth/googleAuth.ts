import { GOOGLE_WEB_CLIENT_ID } from "../config";
import { runAuthCodeFlow } from "./authCodeFlow";
import { googleAuthScopes } from "./mailScopes";

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
//
// The scope set depends on the deployment's writeback policy (see mailScopes), so
// this is the same upfront bulk grant the web sign-in asks for. When the write
// scope is included, include_granted_scopes widens an existing readonly grant
// instead of replacing it, mirroring the web connect URL builder. The user can
// still untick the write permission on Google's granular consent screen; the API
// then stores a read-only grant and writeback stays inert.
export async function requestGoogleAuth(): Promise<GoogleAuthResult> {
  const { scope: requestedScope, writeScope } = await googleAuthScopes();
  // Google returns the code as `code`; the API's /auth/google contract names it
  // `serverAuthCode`, so rename it here.
  const { code, scope, redirectUri } = await runAuthCodeFlow({
    authorizeUrl: AUTHORIZE_URL,
    clientId: GOOGLE_WEB_CLIENT_ID,
    missingClientIdMessage: "VITE_GOOGLE_WEB_CLIENT_ID is not configured",
    scope: requestedScope,
    extraParams: {
      access_type: "offline",
      prompt: "consent",
      ...(writeScope ? { include_granted_scopes: "true" } : {}),
    },
    onCancel: () => new GoogleAuthCancelledError(),
  });
  return { serverAuthCode: code, scope, redirectUri };
}
