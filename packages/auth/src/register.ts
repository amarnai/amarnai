import crypto from "crypto";
import { db } from "@amarnai/db";

// Email-verification tokens are valid for 24 hours.
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

// Minimum gap between verification resends for the same account. Mirrors
// forgot-password's throttle: a second /auth/register on the same unverified
// account resends its link, and this window stops that path from being used to
// bomb the owner's inbox.
const RESEND_THROTTLE_MS = 60 * 1000;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Replaces any outstanding email-verification token for the user with a fresh
// one and returns the raw token. The caller is responsible for emailing the
// link (kept out of this package so @amarnai/auth carries no mail dependency).
export async function rotateVerificationToken(userId: string): Promise<string> {
  await db.verificationToken.deleteMany({
    where: { userId, type: "EMAIL_VERIFICATION" },
  });
  const token = generateToken();
  await db.verificationToken.create({
    data: {
      userId,
      token,
      type: "EMAIL_VERIFICATION",
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });
  return token;
}

export type RegisterEmailInput = {
  email: string;
};

export type RegisterEmailResult =
  // A brand-new account was created, OR an existing unverified account is being
  // re-registered: in both cases a verification link should be sent, unless a
  // recent resend is still within the throttle window (verificationToken null →
  // send nothing). The caller emails the link and never signs the user in.
  | { status: "verify"; verificationToken: string | null }
  // An account with this email already exists and is verified. The caller emails
  // a "you already have an account, sign in" notice (only the real owner sees it).
  | { status: "already_registered" }
  // A verified account with no password (Google sign-in). The caller emails a
  // "sign in with Google" notice.
  | { status: "google_only" };

// Email-first registration. Creates the account row for a genuinely new email (no
// password — that is set later at the verify step by the proven mailbox owner),
// or resends verification for an existing unverified account, or reports an
// existing verified account so the caller can email the right guidance. Shared by
// the web register action and the API /auth/register endpoint so the policy lives
// in exactly one place.
//
// Security: this NEVER stores a password and NEVER hands back a session. The
// returned status is used only to choose which email to send server-side; every
// caller returns the SAME neutral response regardless, so the response cannot
// reveal whether the email is registered (no account-enumeration oracle). And
// because no password is stored before the mailbox owner proves control, an
// account pre-hijack is structurally impossible on this path.
export async function registerEmail({
  email,
}: RegisterEmailInput): Promise<RegisterEmailResult> {
  const existing = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      emailVerified: true,
      credential: { select: { id: true } },
      verificationTokens: {
        where: { type: "EMAIL_VERIFICATION" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  if (existing) {
    if (existing.emailVerified) {
      return existing.credential
        ? { status: "already_registered" }
        : { status: "google_only" };
    }

    // Existing but unverified: resend the verification link, throttled.
    const last = existing.verificationTokens[0];
    if (last && Date.now() - last.createdAt.getTime() < RESEND_THROTTLE_MS) {
      return { status: "verify", verificationToken: null };
    }
    const verificationToken = await rotateVerificationToken(existing.id);
    return { status: "verify", verificationToken };
  }

  // Brand-new email: create the account with no credential. The password is set
  // at the verify step (see the verify-email route), so a caller who never owned
  // this mailbox can never end up controlling a password on it.
  const user = await db.user.create({
    data: { email },
    select: { id: true },
  });
  const verificationToken = await rotateVerificationToken(user.id);
  return { status: "verify", verificationToken };
}
