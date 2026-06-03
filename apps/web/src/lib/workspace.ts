import { cache } from "react";
import { cookies } from "next/headers";
import { db, ensureInboxNode } from "@amarnai/db";

const WORKSPACE_COOKIE = "amarnai-workspace";

export function getWorkspaceLimit(): number {
  const envLimit = process.env.MAX_WORKSPACES_PER_USER;
  if (envLimit) return parseInt(envLimit, 10);
  return Infinity;
}

export const getSelectedWorkspace = cache(async function getSelectedWorkspace(userId: string): Promise<{ id: string; name: string; plan: string }> {
  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  if (selectedId) {
    const ws = await db.workspace.findFirst({
      where: {
        id: selectedId,
        members: { some: { userId } },
      },
      select: { id: true, name: true, plan: true },
    });
    if (ws) return ws;
  }

  return getOrCreateDefaultWorkspace(userId);
});

export async function getOrCreateDefaultWorkspace(userId: string) {
  // Prefer a workspace owned by this user.
  const owned = await db.workspace.findFirst({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, plan: true },
  });
  if (owned) return owned;

  // Fall back to a workspace where the user is a team member.
  const membership = await db.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { id: true, name: true, plan: true } } },
  });
  if (membership) return membership.workspace;

  // New user — create their first workspace.
  const created = await db.workspace.create({
    data: {
      name: "My Workspace",
      ownerUserId: userId,
      members: {
        create: { userId, role: "OWNER" },
      },
    },
    select: { id: true, name: true, plan: true },
  });
  await ensureInboxNode(created.id);
  return created;
}
