"use server";

import { revalidatePath } from "next/cache";
import { requireUser, assertWorkspaceOwner } from "@/lib/session";
import { db } from "@amarnai/db";
import { api } from "@/lib/api";

export async function disconnectGmailAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await db.gmailConnection.deleteMany({ where: { workspaceId } });

  revalidatePath("/settings");
}

export async function sweepInboxAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await api.sweepInbox(workspaceId);
}

export async function pauseSortingAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await api.pauseSorting(workspaceId);
  revalidatePath("/emails");
}

export async function resumeSortingAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await api.resumeSorting(workspaceId);
  revalidatePath("/emails");
}

export async function cancelClassifyAction(
  workspaceId: string,
  threadId: string
): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await api.cancelClassify(workspaceId, threadId);
  revalidatePath(`/emails/${threadId}`);
}

export async function startSortingAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await api.startSorting(workspaceId);
  revalidatePath("/emails");
}
