import crypto from "crypto";
import {
  GMAIL_READONLY_SCOPE,
  GmailApiError,
  exchangeAuthCode,
  fetchGmailProfile,
  fetchGoogleSubjectId,
} from "@amarnai/gmail";
import type { GmailProfile, GmailTokens } from "@amarnai/gmail";

// HTTP helpers (token exchange, profile, subject id) now live in @amarnai/gmail
// so the API can share them. Re-export them here so existing web imports from
// "@/lib/gmail-oauth" keep working unchanged.
export { GmailApiError, fetchGmailProfile, fetchGoogleSubjectId };
export type { GmailProfile, GmailTokens };

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_THREADS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";

function getCallbackUrl(): string {
  return process.env["GMAIL_OAUTH_CALLBACK_URL"] ?? "http://localhost:3000/api/gmail/callback";
}

// ─── State signing ────────────────────────────────────────────────────────────

type OAuthState = {
  workspaceId: string;
  userId: string;
  nonce: string;
  ts: number;
};

function signState(payload: OAuthState): string {
  const secret = process.env["AUTH_SECRET"] ?? "";
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString("base64url");
}

export function generateState(workspaceId: string, userId: string): string {
  return signState({
    workspaceId,
    userId,
    nonce: crypto.randomBytes(16).toString("hex"),
    ts: Date.now(),
  });
}

export function verifyState(
  encoded: string,
  expectedUserId: string,
  expectedWorkspaceId: string
): OAuthState {
  let parsed: OAuthState & { sig: string };
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState & {
      sig: string;
    };
  } catch {
    throw new Error("Invalid OAuth state");
  }

  const { sig, ...payload } = parsed;
  const secret = process.env["AUTH_SECRET"] ?? "";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
    throw new Error("OAuth state signature mismatch");
  }

  if (Date.now() - payload.ts > 10 * 60 * 1000) {
    throw new Error("OAuth state expired");
  }

  if (payload.userId !== expectedUserId) {
    throw new Error("OAuth state user mismatch");
  }

  if (payload.workspaceId !== expectedWorkspaceId) {
    throw new Error("OAuth state workspace mismatch");
  }

  return payload;
}

// ─── OAuth URL ────────────────────────────────────────────────────────────────
// Requests gmail.readonly — minimum scope for the MVP triage feature set.
// Will be upgraded to mail.google.com when compose/send/delete ship.

export function buildGmailAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env["AUTH_GOOGLE_ID"] ?? "",
    redirect_uri: getCallbackUrl(),
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ─── Token exchange (web callback) ──────────────────────────────────────────────
// Thin wrapper that pins the redirect URI to the web callback so existing call
// sites keep their single-argument signature.

export function exchangeCodeForTokens(code: string): Promise<GmailTokens> {
  return exchangeAuthCode(code, getCallbackUrl());
}

// ─── List recent thread IDs ───────────────────────────────────────────────────

export async function listRecentGmailThreadIds(
  accessToken: string,
  maxResults = 10
): Promise<string[]> {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  const res = await fetch(`${GMAIL_THREADS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    type ErrorBody = { error?: { status?: string; message?: string } };
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    const googleError = body.error?.status ?? body.error?.message;
    throw new GmailApiError(`Gmail threads list failed: ${res.status}`, res.status, googleError);
  }
  type ThreadList = { threads?: Array<{ id: string }> };
  const data = (await res.json()) as ThreadList;
  return (data.threads ?? []).map((t) => t.id);
}
