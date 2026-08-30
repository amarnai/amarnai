// Minimal structural edge shape so this works for both the @aziru/shared and
// @aziru/api-client taxonomy edge types without coupling to either.
type DescendantEdge = { sourceNodeId: string; targetNodeId: string };

/**
 * All nodes reachable from `nodeId` by following edges (its descendants),
 * excluding `nodeId` itself. Used to keep a node from being re-parented under its
 * own subtree, which the server would reject as a cycle.
 */
export function descendantIds(
  edges: readonly DescendantEdge[],
  nodeId: string,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const e of edges) {
    const list = childrenByParent.get(e.sourceNodeId) ?? [];
    list.push(e.targetNodeId);
    childrenByParent.set(e.sourceNodeId, list);
  }
  const out = new Set<string>();
  const queue = [...(childrenByParent.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of childrenByParent.get(id) ?? []) queue.push(child);
  }
  return out;
}
