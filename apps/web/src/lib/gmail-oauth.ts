import crypto from "crypto";
import {
  GMAIL_READONLY_SCOPE,
  GMAIL_MODIFY_SCOPE,
  GmailApiError,
  exchangeAuthCode,
  fetchGmailProfile,
} from "@amarnai/gmail";
import type { GmailProfile, GmailTokens } from "@amarnai/gmail";
import { isLabelWritebackEnabled } from "./writeback-flag";

// HTTP helpers (token exchange, profile) now live in @amarnai/gmail
// so the API can share them. Re-export them here so existing web imports from
// "@/lib/gmail-oauth" keep working unchanged.
export { GmailApiError, fetchGmailProfile };
export type { GmailProfile, GmailTokens };

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_THREADS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";

function getCallbackUrl(): string {
  return process.env["GMAIL_OAUTH_CALLBACK_URL"] ?? "http://localhost:3000/api/gmail/callback";
}

// ─── State signing ────────────────────────────────────────────────────────────

// Why the mailbox OAuth flow ran. "connect" is a fresh connection (default);
// "writeback" is the incremental-consent upgrade that adds the write scope to an
// already-connected mailbox. Signed into the state so the callback cannot be
// tricked into taking the upgrade path (which skips inbox-rotation cleanup).
export type OAuthIntent = "connect" | "writeback";

type OAuthState = {
  workspaceId: string;
  userId: string;
  nonce: string;
  ts: number;
  intent?: OAuthIntent;
};

function signState(payload: OAuthState): string {
  const secret = process.env["AUTH_SECRET"] ?? "";
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString("base64url");
}

export function generateState(
  workspaceId: string,
  userId: string,
  intent: OAuthIntent = "connect",
): string {
  return signState({
    workspaceId,
    userId,
    nonce: crypto.randomBytes(16).toString("hex"),
    ts: Date.now(),
    intent,
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
// When the writeback feature is enabled, gmail.modify is requested UPFRONT on
// every connect (product decision: writeback is on by default, and upcoming
// in-Gmail features need the same grant — see writeback-flag.ts). With the
// feature off, connects stay readonly-only. `opts.writeback` forces the write
// scope for the explicit upgrade flow (a pre-feature connection re-consenting);
// include_granted_scopes=true makes Google widen the grant instead of replacing it.

export function buildGmailAuthUrl(
  state: string,
  opts: { writeback?: boolean } = {},
): string {
  const wantsWriteScope = opts.writeback || isLabelWritebackEnabled();
  const scope = wantsWriteScope
    ? `${GMAIL_READONLY_SCOPE} ${GMAIL_MODIFY_SCOPE}`
    : GMAIL_READONLY_SCOPE;
  const params = new URLSearchParams({
    client_id: process.env["AUTH_GOOGLE_ID"] ?? "",
    redirect_uri: getCallbackUrl(),
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  if (wantsWriteScope) params.set("include_granted_scopes", "true");
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ─── Token exchange (web callback) ──────────────────────────────────────────────
// Thin wrapper that pins the redirect URI to the web callback so existing call
// sites keep their single-argument signature.

export function exchangeCodeForTokens(
  code: string,
  // Accepted for signature parity with the shared callback config. Google derives
  // granted scopes from the authorization code, so no scope is re-specified here
  // (unlike Microsoft, whose refresh tokens are scope-bound).
  _opts: { writeback?: boolean } = {},
): Promise<GmailTokens> {
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
