import { MarkerType, type Edge } from "@xyflow/react";
import type { TaxonomyNode, TaxonomyEdge } from "@aziru/shared";
import { computeIgnoredReasons, type IgnoredReason } from "@aziru/core/taxonomy";
import { TaxonomyNodeCard, type TaxonomyRFNode } from "./TaxonomyNodeCard.js";
import { TaxonomyEdgeRenderer } from "./TaxonomyEdge.js";
import { readEdgeColors } from "./tokens.js";

// Shared by the read-only preview and the editor so the two surfaces can never
// drift into rendering the same taxonomy differently.
export const taxonomyNodeTypes = { taxonomy: TaxonomyNodeCard };
export const taxonomyEdgeTypes = { "taxonomy-edge": TaxonomyEdgeRenderer };

/**
 * ReactFlow's default minimum zoom is 0.5, which is not enough to fit a tree of
 * any depth into the 360px extension panel: levels are laid out 300px apart, so
 * a three-level plan needs roughly 0.36 and would otherwise be silently clipped
 * by fitView. Allowing a much smaller floor makes "show me my whole plan" work
 * on a narrow surface; the user zooms in to read.
 */
export const TAXONOMY_MIN_ZOOM = 0.1;

export function toRFNode(n: TaxonomyNode, ignoredReason: IgnoredReason): TaxonomyRFNode {
  return {
    id: n.id,
    type: "taxonomy",
    position: { x: n.positionX, y: n.positionY },
    data: { node: n, ignoredReason },
  };
}

export function toRFEdge(e: TaxonomyEdge, ignoredMap: Map<string, IgnoredReason>): Edge {
  const targetIgnored = ignoredMap.has(e.targetNodeId);
  const colors = readEdgeColors();
  return {
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: "taxonomy-edge",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: targetIgnored ? colors.warn : colors.default,
    },
    data: { targetIgnored },
  };
}

export function toRFNodes(nodes: TaxonomyNode[], edges: TaxonomyEdge[]): TaxonomyRFNode[] {
  const ignoredMap = computeIgnoredReasons(nodes, edges);
  return nodes.map((n) => toRFNode(n, ignoredMap.get(n.id) ?? null));
}

export function toRFEdges(edges: TaxonomyEdge[], nodes: TaxonomyNode[]): Edge[] {
  const ignoredMap = computeIgnoredReasons(nodes, edges);
  return edges.map((e) => toRFEdge(e, ignoredMap));
}
