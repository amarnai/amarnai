import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@aziru/config";

// Stateless one-click unsubscribe tokens for lifecycle emails.
//
// The token is an HMAC-SHA256 over the user id, keyed by the same server secret
// that signs access tokens (config.authJwtSecret). A purpose label is mixed into
// the message so an unsubscribe signature can never be confused with any other
// HMAC the secret might key. No DB row is needed: the link is fully self-
// describing (?u=<userId>&sig=<token>) and verifiable on its own. Rotating the
// secret invalidates outstanding links, which is acceptable for unsubscribe.

const PURPOSE = "lifecycle-unsubscribe";

export function signUnsubscribeToken(userId: string): string {
  return createHmac("sha256", config.authJwtSecret)
    .update(`${PURPOSE}:${userId}`)
    .digest("hex");
}

/** Constant-time verification. False on any length/format mismatch. */
export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = signUnsubscribeToken(userId);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
