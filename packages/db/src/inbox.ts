import { db } from "./client";

export async function ensureInboxNode(workspaceId: string): Promise<void> {
  const existing = await db.taxonomyNode.findFirst({
    where: { workspaceId, isRoot: true },
    select: { id: true },
  });
  if (existing) return;

  await db.taxonomyNode.create({
    data: {
      workspaceId,
      name: "Inbox",
      isRoot: true,
      isVisibleCategory: false,
      canReceiveEmails: false,
    },
  });
}
