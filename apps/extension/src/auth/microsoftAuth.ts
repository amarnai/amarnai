import { MS_CLIENT_ID } from "../config";
import { runAuthCodeFlow, type AuthCodeFlowResult } from "./authCodeFlow";

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

export type MicrosoftAuthResult = AuthCodeFlowResult;

// Runs the Microsoft OAuth *code* flow and returns the authorization code for the
// API to redeem. The code must be redeemed against the returned redirect URI,
// which the API pins on exchangeAuthCode — so that redirect must be registered on
// the Microsoft app registration. Unlike Google, Microsoft returns a refresh token
// whenever offline_access is granted, so no forced consent prompt is needed;
// prompt=select_account lets the user pick which mailbox to connect.
export function requestMicrosoftAuth(): Promise<MicrosoftAuthResult> {
  return runAuthCodeFlow({
    authorizeUrl: AUTHORIZE_URL,
    clientId: MS_CLIENT_ID,
    missingClientIdMessage: "VITE_MS_CLIENT_ID is not configured",
    scope: SCOPES,
    extraParams: { response_mode: "query", prompt: "select_account" },
    onCancel: () => new MicrosoftAuthCancelledError(),
  });
}
