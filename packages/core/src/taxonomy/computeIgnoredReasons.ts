export type IgnoredReason = "no-incoming" | null;

// Minimal structural shapes so this works for both the @aziru/shared and
// @aziru/api-client taxonomy node/edge types without coupling to either.
type IgnoredNode = { id: string; isRoot: boolean };
type IgnoredEdge = { sourceNodeId: string; targetNodeId: string };

/**
 * A non-root node is ignored when it is not reachable from the root by
 * following edges (source -> target). This covers both nodes with no incoming
 * edge at all and nodes that only sit in a disconnected subgraph (e.g. an
 * island whose nodes link to each other but never back to the root). Such
 * nodes never receive routed threads, mirroring how the router enumerates
 * candidate paths from the root.
 */
export function computeIgnoredReasons(
  nodes: readonly IgnoredNode[],
  edges: readonly IgnoredEdge[],
): Map<string, IgnoredReason> {
  const root = nodes.find((n) => n.isRoot);

  // Build reachable set via BFS from the root. With no root, nothing is
  // reachable and every non-root node is ignored.
  const reachable = new Set<string>();
  if (root) {
    const childrenByParent = new Map<string, string[]>();
    for (const edge of edges) {
      const children = childrenByParent.get(edge.sourceNodeId) ?? [];
      children.push(edge.targetNodeId);
      childrenByParent.set(edge.sourceNodeId, children);
    }
    reachable.add(root.id);
    const queue: string[] = [root.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of childrenByParent.get(current) ?? []) {
        if (reachable.has(child)) continue;
        reachable.add(child);
        queue.push(child);
      }
    }
  }

  const result = new Map<string, IgnoredReason>();
  for (const node of nodes) {
    if (node.isRoot) continue;
    if (!reachable.has(node.id)) {
      result.set(node.id, "no-incoming");
    }
  }
  return result;
}
