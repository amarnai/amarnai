import { MS_CLIENT_ID } from "../config";
import { runAuthCodeFlow, type AuthCodeFlowResult } from "./authCodeFlow";
import { microsoftAuthScopes } from "./mailScopes";

// Multitenant + personal accounts, so the authority is /common (mirrors the web
// buildOutlookAuthUrl and the API's confidential Web client).
const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

export class MicrosoftAuthCancelledError extends Error {
  constructor() {
    super("Microsoft sign-in was cancelled");
    this.name = "MicrosoftAuthCancelledError";
  }
}

export type MicrosoftAuthResult = AuthCodeFlowResult;

// Runs the Microsoft OAuth *code* flow and returns the authorization code for the
// API to redeem. The code must be redeemed against the returned redirect URI,
// which the API pins on exchangeAuthCode — so that redirect must be registered on
// the Microsoft app registration. Unlike Google, Microsoft returns a refresh token
// whenever offline_access is granted, so no forced consent prompt is needed;
// prompt=select_account lets the user pick which mailbox to connect.
//
// The scope set depends on the deployment's writeback policy (see mailScopes),
// matching the web sign-in's upfront bulk grant. The write scopes are added to the
// read set, never substituted for it: Microsoft refresh tokens are scope-bound, so
// keeping Mail.Read is what lets a declined or tenant-restricted write consent
// still yield a working read-only connection.
export async function requestMicrosoftAuth(): Promise<MicrosoftAuthResult> {
  const { scope } = await microsoftAuthScopes();
  return runAuthCodeFlow({
    authorizeUrl: AUTHORIZE_URL,
    clientId: MS_CLIENT_ID,
    missingClientIdMessage: "VITE_MS_CLIENT_ID is not configured",
    scope,
    extraParams: { response_mode: "query", prompt: "select_account" },
    onCancel: () => new MicrosoftAuthCancelledError(),
  });
}
