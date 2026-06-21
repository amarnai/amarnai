import crypto from "crypto";
import { db } from "@amarnai/db";

// Password-reset tokens are valid for 1 hour.
const RESET_TTL_MS = 60 * 60 * 1000;

// Minimum gap between reset requests for the same account. Mirrors the
// resend-verification window: keeps the public forgot-password endpoint from
// being an email-bomb or an account-enumeration timing oracle.
const RESET_THROTTLE_MS = 60 * 1000;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
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
//   - the account has no password credential (Google-only), or
//   - a reset token was already issued within the throttle window.
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      credential: { select: { id: true } },
      verificationTokens: {
        where: { type: "PASSWORD_RESET" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  if (!user || !user.credential) return null;

  const last = user.verificationTokens[0];
  if (last && Date.now() - last.createdAt.getTime() < RESET_THROTTLE_MS) {
    return null;
  }

  await db.verificationToken.deleteMany({
    where: { userId: user.id, type: "PASSWORD_RESET" },
  });

  const token = generateToken();
  await db.verificationToken.create({
    data: {
      userId: user.id,
      token,
      type: "PASSWORD_RESET",
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  return token;
}
