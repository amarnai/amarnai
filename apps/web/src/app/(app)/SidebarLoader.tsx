import { auth } from "@/auth";
import { db } from "@amarnai/db";
import { Sidebar } from "@/components/Sidebar";
import { getSelectedWorkspace, getWorkspaceLimit } from "@/lib/workspace";

export async function SidebarLoader() {
  const session = await auth();
  const userId = session?.user?.id;

  const user = session?.user
    ? { email: session.user.email ?? "", name: session.user.name ?? null }
    : null;

  let workspace: { id: string; name: string } | null = null;
  let workspaces: Array<{ id: string; name: string }> = [];
  let canCreateWorkspace = false;

  if (userId) {
    const limit = getWorkspaceLimit();
    [workspaces, workspace] = await Promise.all([
      db.workspace.findMany({
        where: { members: { some: { userId } } },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
      getSelectedWorkspace(userId),
    ]);

    const ownedWorkspaceCount = await db.workspace.count({ where: { ownerUserId: userId } });
    canCreateWorkspace = !isFinite(limit) || ownedWorkspaceCount < limit;
  }

  return (
    <Sidebar
      user={user}
      workspace={workspace}
      workspaces={workspaces}
      canCreateWorkspace={canCreateWorkspace}
    />
  );
}
