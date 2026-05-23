import type { TaxonomyNode, TaxonomyEdge } from "@/lib/api";

export type IgnoredReason = "no-incoming" | null;

export function computeIgnoredReasons(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[]
): Map<string, IgnoredReason> {
  const result = new Map<string, IgnoredReason>();
  for (const node of nodes) {
    if (node.isRoot) continue;
    const hasIncoming = edges.some((e) => e.targetNodeId === node.id);
    if (!hasIncoming) {
      result.set(node.id, "no-incoming");
    }
  }
  return result;
}
