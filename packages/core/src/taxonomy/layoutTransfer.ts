import type { TaxonomyTransferFile } from "@aziru/shared";

// Deterministic left-to-right tree layout for a TaxonomyTransferFile, matching
// the hand-authored convention used by the built-in templates:
//   - root at x=0, each deeper level at +300 (LEVEL_X)
//   - leaves spaced 140px apart vertically (LEAF_GAP)
//   - each parent centered on the midpoint of its children's span
//   - whole tree vertically centered on the root (root.y = 0)
//
// Generated taxonomies carry whatever positions the LLM emitted (often
// arbitrary); running this before persisting gives them the same clean
// left-to-right shape as templates when rendered on the canvas.

const LEVEL_X = 300;
const LEAF_GAP = 140;

export function layoutTaxonomyTransfer(file: TaxonomyTransferFile): TaxonomyTransferFile {
  const root = file.nodes.find((n) => n.isRoot);
  if (!root) return file;

  // Stable child ordering: by the order targets appear in the node list.
  const indexOf = new Map(file.nodes.map((n, i) => [n.ref, i]));
  const childrenOf = new Map<string, string[]>();
  for (const e of file.edges) {
    const list = childrenOf.get(e.sourceRef) ?? [];
    list.push(e.targetRef);
    childrenOf.set(e.sourceRef, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0));
  }

  // Post-order y assignment: leaves get sequential slots, parents the midpoint
  // of their children. Guard against malformed cycles via a visited set.
  const y = new Map<string, number>();
  const depth = new Map<string, number>();
  let leafCursor = 0;

  const assign = (ref: string, d: number, seen: Set<string>): number => {
    if (seen.has(ref)) return y.get(ref) ?? 0;
    seen.add(ref);
    depth.set(ref, d);
    const kids = childrenOf.get(ref) ?? [];
    if (kids.length === 0) {
      const yy = leafCursor * LEAF_GAP;
      leafCursor += 1;
      y.set(ref, yy);
      return yy;
    }
    const childYs = kids.map((k) => assign(k, d + 1, seen));
    const mid = (childYs[0]! + childYs[childYs.length - 1]!) / 2;
    y.set(ref, mid);
    return mid;
  };

  assign(root.ref, 0, new Set());
  const rootY = y.get(root.ref) ?? 0;

  return {
    ...file,
    nodes: file.nodes.map((n) => ({
      ...n,
      positionX: (depth.get(n.ref) ?? 0) * LEVEL_X,
      positionY: (y.get(n.ref) ?? 0) - rootY,
    })),
  };
}
