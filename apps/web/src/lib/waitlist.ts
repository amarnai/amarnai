import crypto from "crypto";

// Closed-beta waitlist mode. While the Google OAuth app is in Testing status,
// only manually allowlisted Google accounts can complete consent, so open
// sign-up is replaced by a waitlist (set WAITLIST_MODE=true). Remove the flag
// once Google verification is approved.

export function isWaitlistMode(): boolean {
  return process.env["WAITLIST_MODE"] === "true";
}

// ─── Form token ───────────────────────────────────────────────────────────────
// HMAC-signed render timestamp passed through the waitlist form. Submissions
// faster than a human can type an email are rejected as bots; the max age
// bounds replay. Same HMAC pattern as the OAuth state in lib/gmail-oauth.ts.

const MIN_FILL_MS = 2_000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

function signTimestamp(ts: string): string {
  const secret = process.env["AUTH_SECRET"] ?? "";
  return crypto.createHmac("sha256", secret).update(ts).digest("hex");
}

export function createWaitlistFormToken(now = Date.now()): string {
  const ts = String(now);
  return Buffer.from(JSON.stringify({ ts, sig: signTimestamp(ts) })).toString("base64url");
}

export function verifyWaitlistFormToken(token: string, now = Date.now()): boolean {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      ts?: string;
      sig?: string;
    };
    if (!parsed.ts || !parsed.sig) return false;

    const expected = signTimestamp(parsed.ts);
    if (!crypto.timingSafeEqual(Buffer.from(parsed.sig, "hex"), Buffer.from(expected, "hex"))) {
      return false;
    }

    const age = now - Number(parsed.ts);
    return age >= MIN_FILL_MS && age <= MAX_FORM_AGE_MS;
  } catch {
    // Malformed base64/JSON or a signature with the wrong length.
    return false;
  }
}

/** Operators allowed to view the waitlist, from comma-separated ADMIN_EMAILS. */
export function isWaitlistAdmin(email: string): boolean {
  const admins = (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
