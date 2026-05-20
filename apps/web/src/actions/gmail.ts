"use server";

import { revalidatePath } from "next/cache";
import { requireUser, assertWorkspaceOwner } from "@/lib/session";
import { db } from "@genizor/db";

export async function disconnectGmailAction(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkspaceOwner(workspaceId, user.id);

  await db.gmailConnection.deleteMany({ where: { workspaceId } });

  revalidatePath("/settings");
}
