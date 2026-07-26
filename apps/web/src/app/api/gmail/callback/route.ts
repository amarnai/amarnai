import { NextRequest } from "next/server";
import { exchangeCodeForTokens, fetchGmailProfile } from "@/lib/gmail-oauth";
import { handleOAuthCallback } from "@/lib/oauth-callback";
import { parseGrantedScopes } from "@amarnai/gmail";

export async function GET(req: NextRequest) {
  return handleOAuthCallback(req, {
    provider: "GMAIL",
    errorParam: "gmail_error",
    source: "gmail/callback",
    pushProvider: "gmail",
    profileFetchError: "gmail_profile_fetch",
    exchangeCodeForTokens,
    // Google's tokeninfo endpoints do not reliably return a stable account id for
    // gmail.readonly-only access tokens, so Gmail has no subjectId.
    fetchProfile: async (accessToken) => ({
      emailAddress: (await fetchGmailProfile(accessToken)).emailAddress,
      subjectId: null,
    }),
    parseScopes: parseGrantedScopes,
    audit: {
      eventType: "gmail.connected",
      entityType: "GmailConnection",
      addressKey: "gmailAddress",
    },
  });
}
