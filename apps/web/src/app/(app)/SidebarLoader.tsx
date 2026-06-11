import { auth } from "@/auth";
import { db } from "@amarnai/db";
import { Sidebar } from "@/components/Sidebar";
import { getSelectedWorkspace } from "@/lib/workspace";

export async function SidebarLoader() {
  const session = await auth();
  const userId = session?.user?.id;

  const user = session?.user
    ? { email: session.user.email ?? "", name: session.user.name ?? null }
    : null;

  let workspace: { id: string; name: string } | null = null;
  let workspaces: Array<{ id: string; name: string }> = [];
  let hasFreeWorkspace = false;

  if (userId) {
    [workspaces, workspace] = await Promise.all([
      db.workspace.findMany({
        where: { members: { some: { userId } } },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
      getSelectedWorkspace(userId),
    ]);

    hasFreeWorkspace =
      (await db.workspace.count({ where: { ownerUserId: userId, plan: "FREE" } })) > 0;
  }

  return (
    <Sidebar
      user={user}
      workspace={workspace}
      workspaces={workspaces}
      hasFreeWorkspace={hasFreeWorkspace}
    />
  );
}
