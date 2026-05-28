import { cookies } from "next/headers";
import { auth } from "@/auth";
import { db } from "@amarnai/db";
import { Sidebar } from "@/components/Sidebar";
import { getWorkspaceLimit } from "@/lib/workspace";

const WORKSPACE_COOKIE = "amarnai-workspace";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const userId = session?.user?.id;

  const user = session?.user
    ? { email: session.user.email ?? "", name: session.user.name ?? null }
    : null;

  let workspace: { id: string; name: string } | null = null;
  let workspaces: Array<{ id: string; name: string }> = [];
  let canCreateWorkspace = false;

  if (userId) {
    workspaces = await db.workspace.findMany({
      where: { ownerUserId: userId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });

    const limit = getWorkspaceLimit();
    canCreateWorkspace = !isFinite(limit) || workspaces.length < limit;

    const cookieStore = await cookies();
    const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;
    workspace =
      workspaces.find((w) => w.id === selectedId) ?? workspaces[0] ?? null;
  }

  return (
    <div className="shell">
      <Sidebar
        user={user}
        workspace={workspace}
        workspaces={workspaces}
        canCreateWorkspace={canCreateWorkspace}
      />
      <main className="main">{children}</main>
    </div>
  );
}
