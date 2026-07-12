import { db } from "@amarnai/db";
import { StaleWhileErrorCache } from "@amarnai/auth";
import type { JWT } from "next-auth/jwt";

// Resolves a web JWT against the current account state on EVERY evaluation, not
// just at sign-in. This is what makes stateless-session invalidation immediate: a
// session-epoch bump — fired when a planted pre-verification credential is
// invalidated (provisionGoogleUser / verify-email) or a password is reset
// (resetPasswordAction) — signs the holder out on their next request instead of
// leaving a planted or stale token valid for up to the 30-day token life.
//
// The lookup runs on every matched request via the auth() middleware wrapper, so
// it goes through a short-TTL cache (see StaleWhileErrorCache): the read is off
// the hot path, and a transient DB error degrades instead of 500ing every
// logged-in page load. A revocation is still honored within one cache TTL.
//
// `isInitialMint` is true only on the sign-in mint (next-auth passes `user` /
// trigger === "signIn"), where the token has no epoch yet and must be STAMPED
// from the account. On every other evaluation the token is ENFORCED: a token
// minted before a bump — OR one carrying no epoch claim at all (pre-feature, or
// planted) — is treated as signed out. Critically, a missing epoch is never
// "laundered" by stamping it to the current value; that was the hole (N2) that
// let a planted session become permanent.

type SessionAccount = {
  id: string;
  name: string | null;
  emailVerified: Date | null;
  sessionEpoch: number;
};

// Keyed by the token's lowercased email claim; value is the account row, or null
// when the account is gone (a real value, enforced as signed out). Module
// singleton: one per web server instance, so its staleness window is per-instance
// and bounded by the TTL. Exported so tests can isolate state between cases.
export const sessionAccountCache = new StaleWhileErrorCache<SessionAccount | null>();

function loadAccount(email: string): Promise<SessionAccount | null> {
  return db.user.findUnique({
    where: { email },
    select: { id: true, name: true, emailVerified: true, sessionEpoch: true },
  });
}

function signedOut(token: JWT): JWT {
  delete token.userId;
  delete token.isEmailVerified;
  return token;
}

// Refreshes the token's identity fields from the account. Deliberately does NOT
// touch token.sessionEpoch — only the mint path stamps that. On the enforcement
// path the epoch was just proven current (token.sessionEpoch >= dbUser's), and
// the dbUser here may be a stale-but-fresh cached read; writing it back could
// only LOWER a valid token's epoch (downgrading it, so a later fresh read signs
// the user out) or, on a missing-epoch token, LAUNDER it up to current (the N2
// hole this file exists to close). Enforcement verifies the epoch; it never
// rewrites it.
function stampIdentity(token: JWT, dbUser: SessionAccount): JWT {
  token.userId = dbUser.id;
  token.name = dbUser.name;
  token.isEmailVerified = dbUser.emailVerified !== null;
  return token;
}

export async function resolveSessionToken(token: JWT, isInitialMint: boolean): Promise<JWT> {
  // No identity to verify against — treat as signed out.
  if (!token.email) return signedOut(token);

  const email = token.email;

  // Sign-in mint: read the account DIRECTLY and stamp its exact current epoch.
  // Never read through the cache — a stale epoch here would sign the fresh
  // session out on its very next request (e.g. re-login right after a password
  // reset). Never swallow a DB error either: a mint must fail rather than stamp a
  // fallback. Write-through so the enforcement reads that immediately follow are
  // served warm and do not stampede the DB.
  if (isInitialMint) {
    const dbUser = await loadAccount(email);
    sessionAccountCache.set(email, dbUser);
    if (!dbUser) return signedOut(token);
    // The mint is the ONLY place the epoch is stamped, from a fresh authoritative
    // read.
    token.sessionEpoch = dbUser.sessionEpoch;
    return stampIdentity(token, dbUser);
  }

  // Enforcement: serve from the short-TTL cache, degrading on a DB error.
  const outcome = await sessionAccountCache.get(email, () => loadAccount(email));

  // DB down AND this instance never cached the account: leave the token exactly
  // as-is for the duration of the outage. Signing out here would trade a 500
  // storm for a sign-out storm; the token's own claims still carry the last good
  // identity, and any revocation seen before the outage is enforced from cache
  // ("stale"). Every data-driven sign-out below is unchanged.
  if (outcome.status === "unavailable") return token;

  const dbUser = outcome.value;

  // Account no longer exists (deleted) — sign the holder out.
  if (!dbUser) return signedOut(token);

  // Enforce the session epoch. A stale epoch (below the account's current) or a
  // missing epoch claim both fail closed. On the pass path the token's own epoch
  // is left untouched (see stampIdentity) — it was just proven >= the account's.
  if (typeof token.sessionEpoch !== "number" || token.sessionEpoch < dbUser.sessionEpoch) {
    return signedOut(token);
  }

  return stampIdentity(token, dbUser);
}
