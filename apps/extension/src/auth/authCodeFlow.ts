import { ext } from "../platform/ext";

export type AuthCodeFlowConfig = {
  /** OAuth authorize endpoint (no query string). */
  authorizeUrl: string;
  /** OAuth client id; when unset the flow throws missingClientIdMessage. */
  clientId: string | undefined;
  missingClientIdMessage: string;
  /** Space-delimited scope string; also the fallback when the provider echoes none. */
  scope: string;
  /** Provider-specific query params merged after the shared client_id/redirect/scope. */
  extraParams: Record<string, string>;
  /** Factory for the provider's cancel/decline error (thrown on close or access_denied). */
  onCancel: () => Error;
};

export type AuthCodeFlowResult = {
  code: string;
  scope: string;
  redirectUri: string;
};

/**
 * Runs a browser-extension OAuth *authorization code* flow via
 * identity.launchWebAuthFlow and returns the code for the API to redeem. The code
 * must be redeemed against this exact redirect URI (Chrome:
 * https://<ext-id>.chromiumapp.org/, Firefox:
 * https://<hash>.extensions.allizom.org/), which is returned so callers can pass
 * it to the API alongside the code and pin it on the token exchange.
 *
 * The Google and Microsoft flows differ only in the authorize URL, extra query
 * params, scope, and cancel error class — all injected via cfg. Everything else
 * (client-id guard, redirect derivation, launch, result parsing, cancel handling)
 * lives here so the two flows cannot drift on how a close/decline is handled.
 */
export async function runAuthCodeFlow(cfg: AuthCodeFlowConfig): Promise<AuthCodeFlowResult> {
  if (!cfg.clientId) {
    throw new Error(cfg.missingClientIdMessage);
  }

  const redirectUri = ext.identity.getRedirectURL();
  const authUrl =
    `${cfg.authorizeUrl}?` +
    new URLSearchParams({
      client_id: cfg.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: cfg.scope,
      ...cfg.extraParams,
    }).toString();

  let resultUrl: string | undefined;
  try {
    resultUrl = await ext.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch {
    // Both browsers reject (or resolve undefined) when the user closes the window.
    throw cfg.onCancel();
  }
  if (!resultUrl) throw cfg.onCancel();

  const params = new URL(resultUrl).searchParams;
  const code = params.get("code");
  if (!code) {
    // error=access_denied when the user declines consent.
    throw cfg.onCancel();
  }

  return {
    code,
    // The provider echoes the granted scopes; fall back to what we requested.
    scope: params.get("scope") ?? cfg.scope,
    redirectUri,
  };
}
