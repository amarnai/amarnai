import crypto from "crypto";
import { db, Prisma } from "@amarnai/db";
import type { FederatedProvider } from "./provision.js";

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
//
// A single upsert on the (userId, type) unique key, so concurrent issuance can
// never leave two live tokens (and never 500s on a create/create race). createdAt
// is reset on update so the caller-side resend throttle measures from the latest
// issuance.
export async function rotateVerificationToken(userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  await db.verificationToken.upsert({
    where: { userId_type: { userId, type: "EMAIL_VERIFICATION" } },
    create: { userId, token, type: "EMAIL_VERIFICATION", expiresAt },
    update: { token, expiresAt, createdAt: new Date() },
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
  // A verified account with no password (federated sign-in). The caller emails a
  // "sign in with Google"/"sign in with Microsoft" notice for `provider`. When an
  // account carries both links, Google wins the tie — arbitrary but stable, and
  // either notice leads to a working sign-in.
  | { status: "federated_only"; provider: FederatedProvider };

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
      googleLinkedAt: true,
      microsoftLinkedAt: true,
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
      // Has a password → normal sign-in / reset. Truly federated (and no
      // password) → point at that provider. A verified account with NEITHER is an
      // email-first user who never finished setting a password: treat it like
      // "already registered" so the notice email routes them to forgot-password
      // (which issues a set-password token for exactly this state), instead of
      // wrongly telling them to sign in with a provider they never used.
      if (existing.credential) return { status: "already_registered" };
      if (existing.googleLinkedAt) return { status: "federated_only", provider: "google" };
      if (existing.microsoftLinkedAt) return { status: "federated_only", provider: "microsoft" };
      return { status: "already_registered" };
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
  let user: { id: string };
  try {
    user = await db.user.create({ data: { email }, select: { id: true } });
  } catch (err) {
    // Two concurrent registrations of the same new email both passed the
    // findUnique above; the loser's create violates the unique email constraint.
    // The account now exists (created by the winner, which also issued+emailed a
    // verification link), so return the neutral "check your email" response with
    // no token, preserving the anti-enumeration contract without a double-send or
    // a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "verify", verificationToken: null };
    }
    throw err;
  }
  const verificationToken = await rotateVerificationToken(user.id);
  return { status: "verify", verificationToken };
}
