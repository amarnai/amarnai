import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@amarnai/db";

// bcrypt cost factor for stored password hashes. Matches the web sign-up path so
// hashes are interchangeable regardless of which client created the account.
const BCRYPT_ROUNDS = 12;

// Email-verification tokens are valid for 24 hours.
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

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

export type RegisterWithPasswordInput = {
  email: string;
  password: string;
};

export type RegisterWithPasswordResult =
  // A new account was created, or an existing unverified account's password was
  // updated. In both cases a verification token was issued and must be emailed.
  | { status: "created" | "resent"; userId: string; verificationToken: string }
  // An account with this email already exists and is verified.
  | { status: "exists" }
  // An account exists but has no password (Google-only): the user should sign in
  // with Google rather than register a password here.
  | { status: "google_only" };

// Creates a password-based account (or refreshes the password on an existing
// unverified one) and issues an email-verification token. Shared by the web
// register action and the API /auth/register endpoint so the policy lives in
// exactly one place. Does not send the email or sign the user in — the caller
// owns those steps.
export async function registerWithPassword({
  email,
  password,
}: RegisterWithPasswordInput): Promise<RegisterWithPasswordResult> {
  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true, credential: { select: { id: true } } },
  });

  if (existing) {
    if (!existing.credential) return { status: "google_only" };
    if (existing.emailVerified) return { status: "exists" };

    // Unverified account: let the user reset the password and resend the link.
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.userCredential.update({
      where: { userId: existing.id },
      data: { passwordHash },
    });
    const verificationToken = await rotateVerificationToken(existing.id);
    return { status: "resent", userId: existing.id, verificationToken };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await db.user.create({
    data: { email, credential: { create: { passwordHash } } },
    select: { id: true },
  });
  const verificationToken = await rotateVerificationToken(user.id);
  return { status: "created", userId: user.id, verificationToken };
}
