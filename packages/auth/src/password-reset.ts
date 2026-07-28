import crypto from "crypto";
import { db, Prisma } from "@amarnai/db";

// Password-reset tokens are valid for 1 hour.
const RESET_TTL_MS = 60 * 60 * 1000;

// Accepts the base client or an interactive-transaction client so a caller (the
// verify-email route) can issue a reset token inside the same transaction that
// consumes the verification token. Mirrors the DbClient seam elsewhere.
type DbClient = typeof db | Prisma.TransactionClient;

// Minimum gap between reset requests for the same account. Mirrors the
// resend-verification window: keeps the public forgot-password endpoint from
// being an email-bomb or an account-enumeration timing oracle.
const RESET_THROTTLE_MS = 60 * 1000;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Replaces any outstanding password-reset token for the user with a fresh one and
// returns the raw token. Unconditional (no existence/throttle checks) — callers
// that have already decided a reset is warranted use this directly. The email
// verification flow uses it to hand a proven mailbox owner a set-password link
// after an untrusted pre-verification credential is invalidated.
export async function issuePasswordResetToken(
  userId: string,
  client: DbClient = db
): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  // Single upsert on the (userId, type) unique key: concurrent issuance can never
  // leave two live tokens, and there is no delete-then-create window. createdAt is
  // reset on update so the caller-side throttle measures from the latest issuance.
  // Works on a transaction client too (the verify-email flow passes its tx).
  await client.verificationToken.upsert({
    where: { userId_type: { userId, type: "PASSWORD_RESET" } },
    create: { userId, token, type: "PASSWORD_RESET", expiresAt },
    update: { token, expiresAt, createdAt: new Date() },
  });

  return token;
}

export type ApplyPasswordResetResult = "ok" | "already_used";

// Consumes a validated reset token and sets the new password, as ONE
// transaction, token-first. Deleting the token before the other writes means a
// double-submit (or a link-scanner prefetch) loses here with P2025 → "already
// used" instead of resetting twice, and the password change + full session
// revocation commit together or not at all (closing the N7 partial-failure hole
// where the password changed but old sessions survived).
//
// A reset assumes the old password may be compromised, so every other session is
// logged out: all refresh-token families are cleared AND the session epoch is
// bumped (which invalidates the stateless web JWTs a refresh-token revoke cannot
// reach). The caller is responsible for validating the token (existence, type,
// expiry) and hashing the password beforehand.
export async function applyPasswordReset(
  userId: string,
  passwordHash: string,
  token: string
): Promise<ApplyPasswordResetResult> {
  try {
    await db.$transaction(async (tx) => {
      await tx.verificationToken.delete({ where: { token } });
      await tx.userCredential.upsert({
        where: { userId },
        create: { userId, passwordHash },
        update: { passwordHash },
      });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { sessionEpoch: { increment: 1 } },
      });
    });
    return "ok";
  } catch (err) {
    // Token already consumed by a concurrent submit — the whole transaction rolled
    // back, so nothing changed. Report it so the caller shows a friendly message
    // instead of 500ing.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return "already_used";
    }
    throw err;
  }
}

// Issues a password-reset token for the account with this email, or returns null
// when no token should be sent. Shared by the web forgot-password action and the
// API /auth/forgot-password endpoint so the policy lives in exactly one place.
// Does not send the email (kept out of this package so @amarnai/auth carries no
// mail dependency) — the caller emails the link.
//
// Returns null (and the caller stays silent — never revealing whether an account
// exists) when:
//   - no user has this email,
//   - the account cannot hold a password (a Google- or Microsoft-linked account
//     with no password, or an account not yet verified), or
//   - a reset token was already issued within the throttle window.
//
// A reset IS issued for a verified account that has no password and no federated
// link — an email-first user who never finished setting their first password.
// This is the durable, emailed recovery path that keeps such an account from
// being permanently stranded (it is the only door left once the one-time verify
// redirect is gone).
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      emailVerified: true,
      googleLinkedAt: true,
      microsoftLinkedAt: true,
      credential: { select: { id: true } },
      verificationTokens: {
        where: { type: "PASSWORD_RESET" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  if (!user) return null;

  const canSetPassword =
    user.credential !== null ||
    (user.emailVerified !== null &&
      user.googleLinkedAt === null &&
      user.microsoftLinkedAt === null);
  if (!canSetPassword) return null;

  const last = user.verificationTokens[0];
  if (last && Date.now() - last.createdAt.getTime() < RESET_THROTTLE_MS) {
    return null;
  }

  return issuePasswordResetToken(user.id);
}
