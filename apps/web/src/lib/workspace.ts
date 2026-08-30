import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@aziru/db";
import { getOrCreateDefaultWorkspace } from "@aziru/auth";

// Provisioning of the default workspace is shared with the API (see @aziru/auth).
// Re-exported so existing web imports from "@/lib/workspace" keep working.
export { getOrCreateDefaultWorkspace };

const WORKSPACE_COOKIE = "amarnai-workspace";

export const getSelectedWorkspace = cache(async function getSelectedWorkspace(userId: string): Promise<{ id: string; name: string; locale: string; plan: string }> {
  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  if (selectedId) {
    const ws = await db.workspace.findFirst({
      where: {
        id: selectedId,
        members: { some: { userId } },
      },
      select: { id: true, name: true, locale: true, plan: true },
    });
    if (ws) return ws;
  }

  return getOrCreateDefaultWorkspace(userId);
});
