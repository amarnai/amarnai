/** Minimum number of non-root taxonomy nodes that must be reachable from the
 * root before routing is attempted. */
export const TAXONOMY_MIN_NON_ROOT_NODES = 3;

/** Minimal node shape needed to evaluate taxonomy routability. */
type RoutableNode = { id: string; isRoot: boolean; isCatchAll?: boolean };

/** Minimal edge shape: a directed parent -> child link. */
type RoutableEdge = { sourceNodeId: string; targetNodeId: string };

/**
 * Count non-root nodes reachable from the root node by following edges
 * (source -> target).
 *
 * This mirrors how the router enumerates candidate paths: a node can only
 * receive routed threads if there is a path to it from the root. Orphaned
 * nodes and disconnected islands therefore do not count toward the routing
 * threshold, even though they exist in the taxonomy.
 */
export function countRoutableNonRootNodes(
  nodes: ReadonlyArray<RoutableNode>,
  edges: ReadonlyArray<RoutableEdge>
): number {
  const root = nodes.find((n) => n.isRoot);
  if (!root) return 0;

  const childrenByParent = new Map<string, string[]>();
  for (const edge of edges) {
    const children = childrenByParent.get(edge.sourceNodeId) ?? [];
    children.push(edge.targetNodeId);
    childrenByParent.set(edge.sourceNodeId, children);
  }

  // BFS from the root, collecting every reachable node id.
  const reachable = new Set<string>([root.id]);
  const queue: string[] = [root.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (reachable.has(child)) continue;
      reachable.add(child);
      queue.push(child);
    }
  }

  // Catch-all nodes are not real routing destinations, so they must not count
  // toward the routable threshold (a taxonomy of Inbox + catch-all + 2 folders
  // is not routable on the strength of the catch-all).
  let count = 0;
  for (const node of nodes) {
    if (!node.isRoot && !node.isCatchAll && reachable.has(node.id)) count++;
  }
  return count;
}

/**
 * True when enough non-root nodes are reachable from the root for routing to
 * produce meaningful results.
 */
export function isTaxonomyRoutable(
  nodes: ReadonlyArray<RoutableNode>,
  edges: ReadonlyArray<RoutableEdge>
): boolean {
  return countRoutableNonRootNodes(nodes, edges) >= TAXONOMY_MIN_NON_ROOT_NODES;
}
