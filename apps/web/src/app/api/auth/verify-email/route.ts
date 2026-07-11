import { NextRequest, NextResponse } from "next/server";
import { db } from "@amarnai/db";
import { issuePasswordResetToken } from "@amarnai/auth";
import { auth, unstable_update } from "@/auth";
import { getOrCreateDefaultWorkspace } from "@/lib/workspace";
import { sendWelcomeEmail } from "@/lib/email";
import { INVITE_COOKIE, sanitizeInvitePath } from "@/lib/invite-redirect";

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

    // Verify + consume the token in ONE transaction, so the account is never
    // observable as verified-with-an-unset-or-untrusted-credential, and a
    // mid-flight failure rolls everything back — leaving the token intact for a
    // clean retry. The `emailVerified: null` guard keeps a concurrent
    // double-click consistent: only the first transaction flips and consumes the
    // token; the loser's token delete throws and rolls the whole thing back.
    //
    // Email-first accounts (the norm) have no credential yet — we just verify and
    // route the proven owner to set their first password. A credential present at
    // this point is a legacy pre-verification password we did not vouch for, so we
    // also drop it and invalidate its sessions (pre-hijack defense): bump the
    // epoch to kill any planted stateless web JWT, and clear API refresh tokens
    // (inlined from revokeAllRefreshTokensForUser so it joins this transaction).
    const [flip] = credential
      ? await db.$transaction([
          db.user.updateMany({
            where: { id: record.userId, emailVerified: null },
            data: { emailVerified: new Date(), sessionEpoch: { increment: 1 } },
          }),
          db.refreshToken.deleteMany({ where: { userId: record.userId } }),
          db.userCredential.deleteMany({ where: { userId: record.userId } }),
          db.verificationToken.delete({ where: { token } }),
        ])
      : await db.$transaction([
          db.user.updateMany({
            where: { id: record.userId, emailVerified: null },
            data: { emailVerified: new Date() },
          }),
          db.verificationToken.delete({ where: { token } }),
        ]);

    await getOrCreateDefaultWorkspace(record.userId);
    if (flip.count === 1) {
      await sendWelcomeEmailFor(record.userId);
    }

    // Route the now-proven owner to set their password, then sign in.
    const resetToken = await issuePasswordResetToken(record.userId);
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

  await getOrCreateDefaultWorkspace(record.userId);
  await db.verificationToken.delete({ where: { token } });

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
