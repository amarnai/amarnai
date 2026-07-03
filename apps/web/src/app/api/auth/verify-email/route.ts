import { NextRequest, NextResponse } from "next/server";
import { db } from "@amarnai/db";
import { auth, unstable_update } from "@/auth";
import { getOrCreateDefaultWorkspace } from "@/lib/workspace";
import { sendWelcomeEmail } from "@/lib/email";
import { INVITE_COOKIE, sanitizeInvitePath } from "@/lib/invite-redirect";

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

  // Flip emailVerified only on the first verification (null -> now). Gating the
  // welcome email on this transition guarantees it is sent exactly once per user
  // — locally enforced, not dependent on token rotation/deletion elsewhere.
  const firstVerification = await db.user.updateMany({
    where: { id: record.userId, emailVerified: null },
    data: { emailVerified: new Date() },
  });

  await getOrCreateDefaultWorkspace(record.userId);

  await db.verificationToken.delete({ where: { token } });

  // Welcome email — best-effort, fire-and-forget, only on the first verification.
  // This route is the single point where emailVerified transitions for both web
  // and mobile users (both verify via this link). A send failure must never
  // affect verification or the redirect.
  if (firstVerification.count === 1) {
    const user = await db.user.findUnique({
      where: { id: record.userId },
      select: { email: true, name: true },
    });
    if (user) {
      await sendWelcomeEmail(user.email, user.name).catch((err) => {
        console.error("[verify-email] Failed to send welcome email:", err);
      });
    }
  }

  // If the user is signed in on this browser, refresh the JWT so the
  // middleware sees isEmailVerified: true immediately, then go straight to the app.
  const session = await auth();
  if (session?.user?.id === record.userId) {
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
