import { db } from "@amarnai/db";
import type { JWT } from "next-auth/jwt";

// Resolves a web JWT against the current account state on EVERY evaluation, not
// just at sign-in. This is what makes stateless-session invalidation immediate: a
// session-epoch bump — fired when a planted pre-verification credential is
// invalidated (provisionGoogleUser / verify-email) or a password is reset
// (resetPasswordAction) — signs the holder out on their next request instead of
// leaving a planted or stale token valid for up to the 30-day token life.
//
// Cost is one indexed read (unique email) per request. If it ever shows up in a
// profile, add a short-TTL in-process epoch cache here and accept a bounded
// invalidation window; the correctness contract stays the same otherwise.
//
// `isInitialMint` is true only on the sign-in mint (next-auth passes `user` /
// trigger === "signIn"), where the token has no epoch yet and must be STAMPED
// from the account. On every other evaluation the token is ENFORCED: a token
// minted before a bump — OR one carrying no epoch claim at all (pre-feature, or
// planted) — is treated as signed out. Critically, a missing epoch is never
// "laundered" by stamping it to the current value; that was the hole (N2) that
// let a planted session become permanent.
export async function resolveSessionToken(token: JWT, isInitialMint: boolean): Promise<JWT> {
  // No identity to verify against — treat as signed out.
  if (!token.email) {
    delete token.userId;
    delete token.isEmailVerified;
    return token;
  }

  const dbUser = await db.user.findUnique({
    where: { email: token.email },
    select: { id: true, name: true, emailVerified: true, sessionEpoch: true },
  });

  // Account no longer exists (deleted) — sign the holder out.
  if (!dbUser) {
    delete token.userId;
    delete token.isEmailVerified;
    return token;
  }

  // Enforce the session epoch on every non-mint evaluation. A stale epoch (below
  // the account's current) or a missing epoch claim both fail closed.
  if (
    !isInitialMint &&
    (typeof token.sessionEpoch !== "number" || token.sessionEpoch < dbUser.sessionEpoch)
  ) {
    delete token.userId;
    delete token.isEmailVerified;
    return token;
  }

  token.userId = dbUser.id;
  token.name = dbUser.name;
  token.isEmailVerified = dbUser.emailVerified !== null;
  token.sessionEpoch = dbUser.sessionEpoch;
  return token;
}
