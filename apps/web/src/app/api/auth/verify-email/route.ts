import { NextRequest, NextResponse } from "next/server";
import { db, Prisma } from "@amarnai/db";
import { issuePasswordResetToken } from "@amarnai/auth";
import { auth, unstable_update } from "@/auth";
import { getOrCreateDefaultWorkspace } from "@/lib/workspace";
import { sendWelcomeEmail, sendPasswordResetEmail } from "@/lib/email";
import { INVITE_COOKIE, sanitizeInvitePath } from "@/lib/invite-redirect";

// Thrown inside the verify transaction when a concurrent click already flipped
// the account to verified: the loser aborts (rolling back) and is routed to
// sign-in rather than 500ing on a doomed token delete.
class VerifyRaceLostError extends Error {}

// Welcome email — best-effort, fire-and-forget, only on the first verification.
// This route is the single point where emailVerified transitions for both web and
// mobile users (both verify via this link). A send failure must never affect
// verification or the redirect.
async function sendWelcomeEmailFor(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (user) {
    await sendWelcomeEmail(user.email, user.name).catch((err) => {
      console.error("[verify-email] Failed to send welcome email:", err);
    });
  }
}

// Emails the set-password link (B3). The reset token is also carried in the
// redirect, but the redirect only reaches the browser that clicked the link;
// emailing it guarantees a durable recovery path if that tab is abandoned —
// critical when a credential was just invalidated. Best-effort, fire-and-forget.
async function sendSetPasswordEmailFor(userId: string, token: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (user) {
    await sendPasswordResetEmail(user.email, token).catch((err) => {
      console.error("[verify-email] Failed to send set-password email:", err);
    });
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const baseUrl = (process.env["AUTH_URL"] ?? req.nextUrl.origin).replace(/\/$/, "");
  const signInUrl = new URL("/sign-in", baseUrl);

  if (!token) {
    signInUrl.searchParams.set("error", "invalid_token");
    return NextResponse.redirect(signInUrl);
  }

  const record = await db.verificationToken.findUnique({
    where: { token },
    select: { userId: true, type: true, expiresAt: true },
  });

  if (!record || record.type !== "EMAIL_VERIFICATION" || record.expiresAt < new Date()) {
    signInUrl.searchParams.set("error", "invalid_token");
    return NextResponse.redirect(signInUrl);
  }

  // Is this browser already signed in AS the account being verified? Only the
  // session that registered the account can have set a password we are willing to
  // trust — this is the discriminator for the pre-hijack guard below. auth() only
  // reads the request cookie, so it is safe to read before the writes.
  const session = await auth();
  const verifierOwnsSession = session?.user?.id === record.userId;

  // Account pre-hijack guard. A password set on this account BEFORE it was ever
  // verified is untrusted unless it was set by THIS browser (the registering
  // session): an unauthenticated caller may have planted it via /auth/register on
  // an email they do not control. Clicking the link proves mailbox ownership, but
  // not that the clicker set the password. We decide from a pre-read so the verify
  // flip and the invalidation can commit together (below).
  const before = await db.user.findUnique({
    where: { id: record.userId },
    select: { emailVerified: true },
  });
  const isFirstVerification = before !== null && before.emailVerified === null;

  if (isFirstVerification && !verifierOwnsSession) {
    const credential = await db.userCredential.findUnique({
      where: { userId: record.userId },
      select: { id: true },
    });

    // Flip to verified, consume the verification token, AND mint the
    // set-password (reset) token in ONE transaction. Issuing the replacement
    // token inside the same transaction that consumes the verification token is
    // what closes the lockout window: a partial failure can never leave the
    // account verified, credential-less, and without a live reset token. A
    // mid-flight failure rolls everything back, leaving the token intact for a
    // clean retry.
    //
    // The `emailVerified: null` guard is the race arbiter for a double-click /
    // link-prefetch: exactly one transaction flips (count 1) and proceeds; the
    // loser sees count 0 and aborts, so we never 500 on a doomed token delete.
    //
    // Email-first accounts (the norm) have no credential yet. A credential present
    // here is a legacy pre-verification password we did not vouch for, so we drop
    // it and invalidate its sessions (pre-hijack defense): bump the epoch to kill
    // any planted stateless web JWT and clear API refresh tokens (inlined from
    // revokeAllRefreshTokensForUser so it joins this transaction).
    let resetToken: string;
    try {
      resetToken = await db.$transaction(async (tx) => {
        const flip = await tx.user.updateMany({
          where: { id: record.userId, emailVerified: null },
          data: credential
            ? { emailVerified: new Date(), sessionEpoch: { increment: 1 } }
            : { emailVerified: new Date() },
        });
        if (flip.count !== 1) throw new VerifyRaceLostError();

        if (credential) {
          await tx.refreshToken.deleteMany({ where: { userId: record.userId } });
          await tx.userCredential.deleteMany({ where: { userId: record.userId } });
        }
        await tx.verificationToken.delete({ where: { token } });
        return issuePasswordResetToken(record.userId, tx);
      });
    } catch (err) {
      // A concurrent click already verified the account and its owner already got
      // a set-password link — just route this loser to sign-in. Any other error
      // rolled the transaction back (token intact), so rethrow for a clean retry.
      if (err instanceof VerifyRaceLostError) {
        signInUrl.searchParams.set("verified", "1");
        return NextResponse.redirect(signInUrl);
      }
      throw err;
    }

    // Post-commit side effects, all best-effort: none may strand the now-verified
    // owner, who already holds a live reset token (emailed here AND in the
    // redirect). The workspace is otherwise provisioned lazily on first sign-in.
    await getOrCreateDefaultWorkspace(record.userId).catch((err) =>
      console.error("[verify-email] workspace:", err instanceof Error ? err.message : err)
    );
    await sendWelcomeEmailFor(record.userId);
    await sendSetPasswordEmailFor(record.userId, resetToken);

    // Route the now-proven owner to set their password, then sign in.
    const resetUrl = new URL("/reset-password", baseUrl);
    resetUrl.searchParams.set("token", resetToken);
    resetUrl.searchParams.set("verified", "1");
    return NextResponse.redirect(resetUrl);
  }

  // Trusted path: the registering session (legacy password account with a live
  // session), or a re-click of an already-verified account. The credential, if
  // any, was set by the proven owner, so it is kept. Flip (idempotent), provision
  // the workspace, consume the token, and route onward.
  const firstVerification = await db.user.updateMany({
    where: { id: record.userId, emailVerified: null },
    data: { emailVerified: new Date() },
  });

  await getOrCreateDefaultWorkspace(record.userId).catch((err) =>
    console.error("[verify-email] workspace:", err instanceof Error ? err.message : err)
  );

  // Consume the token; tolerate a concurrent click having already consumed it
  // (P2025) so a double-click / link-prefetch never 500s.
  try {
    await db.verificationToken.delete({ where: { token } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")) {
      throw err;
    }
  }

  if (firstVerification.count === 1) {
    await sendWelcomeEmailFor(record.userId);
  }

  // If the user is signed in on this browser (the registering session), refresh
  // the JWT so the middleware sees isEmailVerified: true immediately, then go
  // straight to the app.
  if (verifierOwnsSession) {
    await unstable_update({});
    // Resume a pending workspace invite if one was started in this browser.
    const target = sanitizeInvitePath(req.cookies.get(INVITE_COOKIE)?.value);
    const res = NextResponse.redirect(new URL(target, baseUrl));
    res.cookies.delete(INVITE_COOKIE);
    return res;
  }

  signInUrl.searchParams.set("verified", "1");
  return NextResponse.redirect(signInUrl);
}
