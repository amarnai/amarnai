import { NextRequest } from "next/server";
import { exchangeCodeForTokens, fetchOutlookProfile } from "@/lib/outlook-oauth";
import { handleOAuthCallback } from "@/lib/oauth-callback";
import { parseGrantedScopes } from "@amarnai/outlook";

export async function GET(req: NextRequest) {
  return handleOAuthCallback(req, {
    provider: "OUTLOOK",
    errorParam: "outlook_error",
    source: "outlook/callback",
    pushProvider: "outlook",
    profileFetchError: "profile_fetch",
    exchangeCodeForTokens,
    // Graph returns a stable subjectId (Entra object id) up front.
    fetchProfile: fetchOutlookProfile,
    // Microsoft echoes scopes without the resource prefix; parseGrantedScopes
    // matches case-insensitively.
    parseScopes: parseGrantedScopes,
    audit: {
      eventType: "outlook.connected",
      entityType: "EmailConnection",
      addressKey: "emailAddress",
    },
  });
}
