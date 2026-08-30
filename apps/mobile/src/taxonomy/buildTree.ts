import type { TaxonomyNode, TaxonomyEdge } from '@aziru/api-client';
import { computeIgnoredReasons } from '@aziru/core/taxonomy';

// One row in the rendered taxonomy tree. `depth` drives indentation; `ignored`
// marks non-root nodes unreachable from the root (they never receive threads).
export type TaxonomyTreeRow = {
  node: TaxonomyNode;
  depth: number;
  hasChildren: boolean;
  ignored: boolean;
};

export type TaxonomyTree = {
  // Full depth-first ordered rows: root subtree first, then orphan subgraphs.
  rows: TaxonomyTreeRow[];
  childrenByParent: Map<string, string[]>;
  parentByChild: Map<string, string>;
  rootId: string | null;
};

/**
 * Builds an indented, depth-first ordering of the taxonomy for the mobile list.
 * The taxonomy is a tree rooted at the single `isRoot` node; nodes unreachable
 * from the root (orphans / disconnected islands) are appended after the reachable
 * subtree so they stay visible and editable. Child order follows the input node
 * order, which the API returns by creation time.
 */
export function buildTaxonomyTree(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[],
): TaxonomyTree {
  const ignoredMap = computeIgnoredReasons(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = new Map(nodes.map((n, i) => [n.id, i]));

  const childrenByParent = new Map<string, string[]>();
  const parentByChild = new Map<string, string>();
  for (const e of edges) {
    if (!byId.has(e.sourceNodeId) || !byId.has(e.targetNodeId)) continue;
    const list = childrenByParent.get(e.sourceNodeId) ?? [];
    list.push(e.targetNodeId);
    childrenByParent.set(e.sourceNodeId, list);
    parentByChild.set(e.targetNodeId, e.sourceNodeId);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  const root = nodes.find((n) => n.isRoot) ?? null;
  const rows: TaxonomyTreeRow[] = [];
  const visited = new Set<string>();

  function pushSubtree(id: string, depth: number) {
    const node = byId.get(id);
    if (!node || visited.has(id)) return;
    visited.add(id);
    const children = childrenByParent.get(id) ?? [];
    rows.push({
      node,
      depth,
      hasChildren: children.length > 0,
      ignored: ignoredMap.has(id),
    });
    for (const childId of children) pushSubtree(childId, depth + 1);
  }

  if (root) pushSubtree(root.id, 0);
  // Orphan roots (no parent) keep their own sub-hierarchy, rendered at depth 0.
  for (const n of nodes) {
    if (!n.isRoot && !visited.has(n.id) && !parentByChild.has(n.id)) {
      pushSubtree(n.id, 0);
    }
  }
  // Any remainder (e.g. a disconnected island whose nodes only link to each
  // other) so nothing is silently dropped.
  for (const n of nodes) {
    if (!visited.has(n.id)) pushSubtree(n.id, 0);
  }

  return { rows, childrenByParent, parentByChild, rootId: root?.id ?? null };
}

/**
 * Filters the full ordered rows to those currently visible, given a set of
 * collapsed node ids. Relies on the depth-first ordering: once a collapsed node
 * is seen, every following row deeper than it is its descendant and is skipped
 * until the depth returns to the collapsed node's level or shallower.
 */
export function flattenVisible(
  tree: TaxonomyTree,
  collapsedIds: ReadonlySet<string>,
): TaxonomyTreeRow[] {
  const out: TaxonomyTreeRow[] = [];
  let hideBelowDepth: number | null = null;
  for (const row of tree.rows) {
    if (hideBelowDepth !== null) {
      if (row.depth > hideBelowDepth) continue;
      hideBelowDepth = null;
    }
    out.push(row);
    if (row.hasChildren && collapsedIds.has(row.node.id)) {
      hideBelowDepth = row.depth;
    }
  }
  return out;
}
