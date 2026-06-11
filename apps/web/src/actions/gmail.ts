"use server";

import { revalidatePath } from "next/cache";
import { requireUser, assertWorkspaceOwner } from "@/lib/session";
import { apiFor, type DisconnectResult } from "@/lib/api";

// Narrowed on purpose: only what the disconnect UI reports goes to the browser.
export type DisconnectOutcome = Pick<
  DisconnectResult,
  "revoked" | "sharedMailbox" | "erased"
>;

export async function disconnectGmailAction(
  workspaceId: string,
  options?: { eraseData?: boolean }
): Promise<DisconnectOutcome> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  const result = await apiFor(user.id).disconnectGmail(
    workspaceId,
    options?.eraseData ?? false
  );

  revalidatePath("/settings");
  return {
    revoked: result.revoked,
    sharedMailbox: result.sharedMailbox,
    erased: result.erased,
  };
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
