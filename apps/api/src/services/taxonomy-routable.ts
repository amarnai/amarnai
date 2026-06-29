import { db } from "@amarnai/db";
import { isTaxonomyRoutable } from "@amarnai/shared";

/**
 * Whether the workspace taxonomy has enough non-root nodes reachable from the
 * root for routing to produce meaningful results. Orphaned nodes (not linked to
 * the root) and the catch-all are excluded, matching how the router enumerates
 * candidate paths. `isCatchAll` MUST be selected or the catch-all would be
 * miscounted as a routable folder.
 */
export async function isWorkspaceTaxonomyRoutable(workspaceId: string): Promise<boolean> {
  const [nodes, edges] = await Promise.all([
    db.taxonomyNode.findMany({
      where: { workspaceId },
      select: { id: true, isRoot: true, isCatchAll: true },
    }),
    db.taxonomyEdge.findMany({
      where: { workspaceId },
      select: { sourceNodeId: true, targetNodeId: true },
    }),
  ]);
  return isTaxonomyRoutable(nodes, edges);
}
