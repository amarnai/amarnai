import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@aziru/db";
import { INVITE_COOKIE } from "@/lib/invite-redirect";

// Long enough to sign in, or sign up and verify an email, before resuming.
const INVITE_COOKIE_MAX_AGE = 60 * 60;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const appUrl = (process.env["AUTH_URL"] ?? "http://localhost:3000").replace(/\/$/, "");

  if (!token) {
    return NextResponse.redirect(`${appUrl}/sign-in?error=invalid_invite`);
  }

  // Look up the invitation before checking auth so we can validate it exists.
  const invitation = await db.workspaceInvitation.findUnique({
    where: { token },
    select: {
      id: true,
      workspaceId: true,
      invitedEmail: true,
      expiresAt: true,
      workspace: { select: { id: true, name: true, locale: true } },
    },
  });

  if (!invitation || invitation.expiresAt < new Date()) {
    return NextResponse.redirect(`${appUrl}/sign-in?error=invalid_invite`);
  }

  const acceptPath = `/api/workspace-invite/accept?token=${token}`;
  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    // Send the invitee straight to sign-up (email prefilled) when they have no
    // account yet, otherwise to sign-in. Emails are stored as-entered, so match
    // case-insensitively. Either way, remember the invite so the auth flow can
    // resume acceptance afterwards (the emailed verification link carries no
    // query context, so a cookie is the only thing that survives that round-trip).
    const existingUser = await db.user.findFirst({
      where: { email: { equals: invitation.invitedEmail, mode: "insensitive" } },
      select: { id: true },
    });
    const dest = existingUser
      ? `${appUrl}/sign-in?invite=1`
      : `${appUrl}/sign-up?invite=1&email=${encodeURIComponent(invitation.invitedEmail)}`;
    const res = NextResponse.redirect(dest);
    res.cookies.set(INVITE_COOKIE, acceptPath, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: INVITE_COOKIE_MAX_AGE,
    });
    return res;
  }

  const { id: userId, email: userEmail } = session.user as { id: string; email: string };

  // Verify the signed-in user's email matches the invitation.
  if (userEmail.toLowerCase() !== invitation.invitedEmail.toLowerCase()) {
    // Keep the invite pending so switching to the invited account resumes it.
    const res = NextResponse.redirect(
      `${appUrl}/sign-in?error=invite_wrong_account&email=${encodeURIComponent(invitation.invitedEmail)}`
    );
    res.cookies.set(INVITE_COOKIE, acceptPath, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: INVITE_COOKIE_MAX_AGE,
    });
    return res;
  }

  // Check if already a member (idempotent).
  const existing = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
    select: { id: true },
  });

  if (!existing) {
    await db.$transaction([
      db.workspaceMember.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId,
          role: "MEMBER",
        },
      }),
      db.workspaceInvitation.delete({ where: { id: invitation.id } }),
    ]);
  } else {
    // Already a member — clean up the stale invitation.
    await db.workspaceInvitation.delete({ where: { id: invitation.id } }).catch(() => null);
  }

  // Set the new workspace as the active workspace cookie.
  const response = NextResponse.redirect(
    `${appUrl}/emails?joined_workspace=${encodeURIComponent(invitation.workspace.name)}`
  );
  response.cookies.set("aziru-workspace", invitation.workspaceId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  // Follow the joined workspace's language (cache for proxy.ts locale resolution).
  response.cookies.set("aziru_locale", invitation.workspace.locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  // The invite is consumed — clear the pending-invite cookie if one was set.
  response.cookies.delete(INVITE_COOKIE);

  return response;
}

// The post-sign-in server action redirects here to resume a pending invite, and
// the Next.js action client follows that redirect with a POST. The handler is
// token-gated and idempotent, so POST can safely share the GET logic.
export { GET as POST };
