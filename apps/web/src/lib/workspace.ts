import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@amarnai/db";
import { getOrCreateDefaultWorkspace } from "@amarnai/auth";

// Provisioning of the default workspace is shared with the API (see @amarnai/auth).
// Re-exported so existing web imports from "@/lib/workspace" keep working.
export { getOrCreateDefaultWorkspace };

const WORKSPACE_COOKIE = "amarnai-workspace";

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
