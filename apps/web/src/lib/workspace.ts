import { cookies } from "next/headers";
import { db, ensureInboxNode } from "@amarnai/db";

const WORKSPACE_COOKIE = "amarnai-workspace";

export async function getSelectedWorkspace(userId: string): Promise<{ id: string; name: string }> {
  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  if (selectedId) {
    const ws = await db.workspace.findFirst({
      where: { id: selectedId, ownerUserId: userId },
      select: { id: true, name: true },
    });
    if (ws) return ws;
  }

  return getOrCreateDefaultWorkspace(userId);
}

export async function getOrCreateDefaultWorkspace(userId: string) {
  const existing = await db.workspace.findFirst({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  const created = await db.workspace.create({
    data: {
      name: "My Workspace",
      ownerUserId: userId,
      members: {
        create: { userId, role: "OWNER" },
      },
    },
    select: { id: true, name: true },
  });
  await ensureInboxNode(created.id);
  return created;
}
