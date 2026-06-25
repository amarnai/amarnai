import { db } from "@amarnai/db";

/**
 * Whether a user may edit a workspace's taxonomy. OWNERs always may; MEMBERs may
 * only when the workspace has `membersCanEditTaxonomy` enabled.
 *
 * This is the server-side authorization for taxonomy *writes* (generate, and any
 * route that mutates the taxonomy). The web layer also gates these in its server
 * actions, but native clients and direct API/proxy calls reach the API without
 * that gate — so the check must live here too.
 */
export async function isTaxonomyEditor(workspaceId: string, userId: string): Promise<boolean> {
  const [member, workspace] = await Promise.all([
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { membersCanEditTaxonomy: true },
    }),
  ]);
  if (!member) return false;
  if (member.role === "OWNER") return true;
  return workspace?.membersCanEditTaxonomy ?? false;
}
