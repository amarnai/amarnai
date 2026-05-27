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
