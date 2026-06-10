"use server";

import { revalidatePath } from "next/cache";
import { requireUser, assertWorkspaceOwner } from "@/lib/session";
import { apiFor } from "@/lib/api";

export async function disconnectGmailAction(
  workspaceId: string,
  options?: { eraseData?: boolean }
): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await apiFor(user.id).disconnectGmail(workspaceId, options?.eraseData ?? false);

  revalidatePath("/settings");
}

export async function sweepInboxAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await apiFor(user.id).sweepInbox(workspaceId);
}

export async function pauseSortingAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await apiFor(user.id).pauseSorting(workspaceId);
  revalidatePath("/emails");
}

export async function resumeSortingAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await apiFor(user.id).resumeSorting(workspaceId);
  revalidatePath("/emails");
}

export async function cancelClassifyAction(
  workspaceId: string,
  threadId: string
): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await apiFor(user.id).cancelClassify(workspaceId, threadId);
  revalidatePath(`/emails/${threadId}`);
}

export async function startSortingAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await apiFor(user.id).startSorting(workspaceId);
  revalidatePath("/emails");
}
