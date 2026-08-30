"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { db } from "@aziru/db";
import { requireUser } from "@/lib/session";
import { sendWorkspaceInvitationEmail } from "@/lib/email";
import { getCollaboratorLimit } from "@aziru/shared";

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export type InviteMemberResult = { error?: string; success?: boolean };

export async function inviteMemberAction(
  workspaceId: string,
  rawEmail: string
): Promise<InviteMemberResult> {
  const user = await requireUser();

  const email = rawEmail.trim().toLowerCase();
  if (!isValidEmail(email)) return { error: "Enter a valid email address" };

  // Verify caller is the workspace admin.
  const adminMember = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  });
  if (adminMember?.role !== "OWNER") return { error: "Only admins can invite collaborators" };

  // Fetch workspace for name and member count.
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      name: true,
      plan: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!workspace) return { error: "Workspace not found" };

  // Enforce collaborator limit based on the workspace plan.
  const collaboratorLimit = getCollaboratorLimit(workspace.plan);
  const teamMemberCount = workspace.members.filter((m) => m.role !== "OWNER").length;
  if (teamMemberCount >= collaboratorLimit) {
    return { error: "This workspace has reached its collaborator limit" };
  }

  // Prevent inviting the admin themselves.
  if (email === user.email.toLowerCase()) {
    return { error: "You cannot invite yourself" };
  }

  // If the invitee already has an account, check they're not already a member.
  const invitedUser = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (invitedUser) {
    const alreadyMember = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: invitedUser.id } },
      select: { id: true },
    });
    if (alreadyMember) return { error: "This person is already a collaborator" };
  }

  // Upsert the invitation (replace any existing pending invite for this email).
  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await db.workspaceInvitation.upsert({
    where: { workspaceId_invitedEmail: { workspaceId, invitedEmail: email } },
    create: {
      workspaceId,
      invitedEmail: email,
      invitedByUserId: user.id,
      token,
      expiresAt,
    },
    update: {
      invitedByUserId: user.id,
      token,
      expiresAt,
    },
  });

  try {
    await sendWorkspaceInvitationEmail(email, user.name ?? user.email, workspace.name, token);
  } catch {
    // Delete the invitation if we couldn't send the email — don't leave orphaned records.
    await db.workspaceInvitation.deleteMany({
      where: { workspaceId, invitedEmail: email },
    });
    return { error: "Could not send invitation email. Please try again." };
  }

  revalidatePath("/settings");
  return { success: true };
}

export type RemoveMemberResult = { error?: string; success?: boolean };

export async function removeMemberAction(
  workspaceId: string,
  memberUserId: string
): Promise<RemoveMemberResult> {
  const user = await requireUser();

  // Verify caller is the workspace admin.
  const adminMember = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  });
  if (adminMember?.role !== "OWNER") return { error: "Only admins can remove collaborators" };

  // Prevent removing the admin themselves.
  if (memberUserId === user.id) return { error: "You cannot remove yourself" };

  const targetMember = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: memberUserId } },
    select: { role: true },
  });
  if (!targetMember) return { error: "Member not found" };
  if (targetMember.role === "OWNER") return { error: "Cannot remove the workspace admin" };

  await db.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId, userId: memberUserId } },
  });

  revalidatePath("/settings");
  return { success: true };
}

export type CancelInvitationResult = { error?: string; success?: boolean };

export async function cancelInvitationAction(
  workspaceId: string,
  invitationId: string
): Promise<CancelInvitationResult> {
  const user = await requireUser();

  const adminMember = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  });
  if (adminMember?.role !== "OWNER") return { error: "Only admins can cancel invitations" };

  const invitation = await db.workspaceInvitation.findUnique({
    where: { id: invitationId },
    select: { workspaceId: true },
  });
  if (!invitation || invitation.workspaceId !== workspaceId) {
    return { error: "Invitation not found" };
  }

  await db.workspaceInvitation.delete({ where: { id: invitationId } });

  revalidatePath("/settings");
  return { success: true };
}

