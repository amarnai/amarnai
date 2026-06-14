"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, ensureInboxNode } from "@amarnai/db";
import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { disconnectGmailBeforeDeletion } from "@/lib/gmail-teardown";
import { apiFor } from "@/lib/api";

const WORKSPACE_COOKIE = "amarnai-workspace";

export async function switchWorkspaceAction(workspaceId: string): Promise<void> {
  const user = await requireUser();

  // Allow both owners and team members to switch to any workspace they belong to.
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  });
  if (!member) return;

  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/emails");
}

export async function updateWorkspaceNameAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await requireUser();
  const name = (formData.get("name") as string | null)?.trim() ?? "";
  if (!name) return { error: "Workspace name cannot be empty" };
  if (name.length > 100) return { error: "Name must be 100 characters or fewer" };

  const workspace = await getSelectedWorkspace(user.id);

  // Only admins (OWNER) can rename the workspace.
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    select: { role: true },
  });
  if (member?.role !== "OWNER") return { error: "Only admins can rename the workspace" };

  await db.workspace.update({ where: { id: workspace.id }, data: { name } });
  revalidatePath("/", "layout");
  return { success: true };
}

export async function createWorkspaceAction(
  name: string,
): Promise<{ error?: string; success?: boolean }> {
  const user = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { error: "Workspace name cannot be empty" };
  if (trimmed.length > 100) return { error: "Name must be 100 characters or fewer" };

  const existingFree = await db.workspace.count({
    where: { ownerUserId: user.id, plan: "FREE" },
  });
  if (existingFree >= 1) {
    return { error: "You already have a free workspace." };
  }

  const workspace = await db.workspace.create({
    data: {
      name: trimmed,
      ownerUserId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
    select: { id: true },
  });
  await ensureInboxNode(workspace.id);

  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspace.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  return { success: true };
}

export async function deleteWorkspaceAction(
  workspaceId: string,
): Promise<{ error?: string }> {
  const user = await requireUser();

  // Only the admin (OWNER) can delete a workspace.
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: user.id },
    select: { id: true },
  });
  if (!workspace) return { error: "Workspace not found or you are not the admin" };

  const count = await db.workspace.count({ where: { ownerUserId: user.id } });
  if (count <= 1) return { error: "You cannot delete your only workspace" };

  // Cancel queued sorting jobs and revoke the Gmail grant before the rows
  // disappear — after the transaction the disconnect service has nothing to
  // work with. Best-effort: never blocks deletion.
  await disconnectGmailBeforeDeletion(user.id, [workspaceId]);

  // Delete in FK-safe order within a single transaction
  await db.$transaction([
    db.draft.deleteMany({ where: { workspaceId } }),
    db.emailTag.deleteMany({
      where: {
        OR: [
          { emailThread: { workspaceId } },
          { emailMessage: { workspaceId } },
        ],
      },
    }),
    db.emailClassification.deleteMany({ where: { workspaceId } }),
    db.auditLog.deleteMany({ where: { workspaceId } }),
    db.taxonomyEdge.deleteMany({ where: { workspaceId } }),
    db.taxonomyNode.deleteMany({ where: { workspaceId } }),
    db.tag.deleteMany({ where: { workspaceId } }),
    db.emailMessage.deleteMany({ where: { workspaceId } }),
    db.providerSyncState.deleteMany({
      where: { emailAccount: { workspaceId } },
    }),
    db.emailAddressIdentity.deleteMany({
      where: { emailAccount: { workspaceId } },
    }),
    db.emailThread.deleteMany({ where: { workspaceId } }),
    db.emailAccount.deleteMany({ where: { workspaceId } }),
    db.gmailConnection.deleteMany({ where: { workspaceId } }),
    db.gmailSyncSettings.deleteMany({ where: { workspaceId } }),
    db.workspaceInvitation.deleteMany({ where: { workspaceId } }),
    db.workspaceMember.deleteMany({ where: { workspaceId } }),
    db.workspace.delete({ where: { id: workspaceId } }),
  ]);

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;
  if (selectedId === workspaceId) {
    cookieStore.delete(WORKSPACE_COOKIE);
  }

  revalidatePath("/", "layout");
  redirect("/emails");
}

export async function resetWorkspaceAction(
  workspaceId: string,
): Promise<{ error?: string }> {
  const user = await requireUser();

  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: user.id },
    select: { id: true },
  });
  if (!workspace) return { error: "Workspace not found or you are not the admin" };

  // Best-effort Gmail disconnect before wiping taxonomy.
  const hasConnection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { id: true },
  });
  if (hasConnection) {
    try {
      await apiFor(user.id).disconnectGmail(workspaceId, true);
    } catch (err) {
      console.warn(
        "[reset-workspace] Gmail disconnect failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Belt-and-suspenders cleanup in FK-safe order: covers the case where the
  // disconnect above failed. deleteMany on already-deleted rows is a no-op.
  await db.$transaction([
    db.draft.deleteMany({ where: { workspaceId } }),
    db.emailTag.deleteMany({
      where: {
        OR: [
          { emailThread: { workspaceId } },
          { emailMessage: { workspaceId } },
        ],
      },
    }),
    db.emailClassification.deleteMany({ where: { workspaceId } }),
    db.taxonomyEdge.deleteMany({ where: { workspaceId } }),
    db.taxonomyNode.deleteMany({ where: { workspaceId } }),
    db.emailMessage.deleteMany({ where: { workspaceId } }),
    db.providerSyncState.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailAddressIdentity.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailThread.deleteMany({ where: { workspaceId } }),
    db.emailAccount.deleteMany({ where: { workspaceId } }),
    db.gmailSyncSettings.deleteMany({ where: { workspaceId } }),
    db.gmailConnection.deleteMany({ where: { workspaceId } }),
  ]);

  await ensureInboxNode(workspaceId);

  revalidatePath("/", "layout");
  redirect("/emails");
}
