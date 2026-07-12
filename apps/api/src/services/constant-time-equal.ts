import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets (webhook tokens, the internal
 * API secret). A plain `===`/`!==` short-circuits at the first differing byte,
 * which leaks how much of a guessed secret is correct to a timing attacker.
 *
 * `timingSafeEqual` throws on unequal-length buffers, so we length-check first
 * and bail early when the lengths differ. The length of a fixed shared secret
 * is not itself sensitive here, so the early return is acceptable and keeps the
 * byte-wise comparison constant-time for equal-length inputs.
 *
 * Returns false for null/undefined inputs so callers get a safe reject when the
 * secret is unconfigured or the presented value is missing.
 */
export function constantTimeEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
