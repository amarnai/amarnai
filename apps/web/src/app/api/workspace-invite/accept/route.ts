import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@amarnai/db";

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

  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    // Preserve the token through sign-in via callbackUrl.
    const callbackUrl = encodeURIComponent(
      `/api/workspace-invite/accept?token=${token}`
    );
    return NextResponse.redirect(`${appUrl}/sign-in?callbackUrl=${callbackUrl}`);
  }

  const { id: userId, email: userEmail } = session.user as { id: string; email: string };

  // Verify the signed-in user's email matches the invitation.
  if (userEmail.toLowerCase() !== invitation.invitedEmail.toLowerCase()) {
    return NextResponse.redirect(
      `${appUrl}/sign-in?error=invite_wrong_account&email=${encodeURIComponent(invitation.invitedEmail)}`
    );
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
  response.cookies.set("amarnai-workspace", invitation.workspaceId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  // Follow the joined workspace's language (cache for proxy.ts locale resolution).
  response.cookies.set("amarnai_locale", invitation.workspace.locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
