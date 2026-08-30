import { db } from "@aziru/db";
import { Sidebar } from "@/components/Sidebar";
import { getSessionUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";

export async function SidebarLoader() {
  // getSessionUser only resolves when the session id maps to a real User row, so
  // a stale JWT (deleted user, or a reset dev DB) can't reach workspace
  // provisioning and trip a foreign-key violation.
  const sessionUser = await getSessionUser();
  const userId = sessionUser?.id;

  const user = sessionUser
    ? { email: sessionUser.email, name: sessionUser.name ?? null }
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
