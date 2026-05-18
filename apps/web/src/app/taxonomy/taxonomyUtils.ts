import type { TaxonomyNode, TaxonomyEdge } from "../../lib/api";

const DEFAULT_SORTING_QUESTION = "Describe when emails should follow this path.";

export function isMissingSortingQuestion(q: string | null | undefined): boolean {
  if (!q) return true;
  const trimmed = q.trim();
  return trimmed === "" || trimmed === DEFAULT_SORTING_QUESTION;
}

export type IgnoredReason = "no-incoming" | "all-invalid" | "invalid-leaf" | null;

export type NodeValidityWarning = "dead-end" | "visible-not-receivable" | "hidden-destination";

export function computeNodeValidityWarnings(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[]
): Map<string, NodeValidityWarning[]> {
  const result = new Map<string, NodeValidityWarning[]>();
  const outgoingByNode = new Map<string, TaxonomyEdge[]>();
  for (const edge of edges) {
    const list = outgoingByNode.get(edge.sourceNodeId) ?? [];
    list.push(edge);
    outgoingByNode.set(edge.sourceNodeId, list);
  }
  for (const node of nodes) {
    if (node.isRoot) continue;
    const warnings: NodeValidityWarning[] = [];
    const outgoing = outgoingByNode.get(node.id) ?? [];
    const hasValidOutgoing = outgoing.some((e) => !isMissingSortingQuestion(e.sortingQuestion));
    if (!node.canReceiveEmails && !hasValidOutgoing) {
      warnings.push("dead-end");
    }
    if (node.isVisibleCategory && !node.canReceiveEmails) {
      warnings.push("visible-not-receivable");
    }
    if (node.canReceiveEmails && !node.isVisibleCategory) {
      warnings.push("hidden-destination");
    }
    if (warnings.length > 0) {
      result.set(node.id, warnings);
    }
  }
  return result;
}

export function computeIgnoredReasons(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[]
): Map<string, IgnoredReason> {
  const result = new Map<string, IgnoredReason>();
  const outgoingCount = new Map<string, number>();
  for (const edge of edges) {
    outgoingCount.set(edge.sourceNodeId, (outgoingCount.get(edge.sourceNodeId) ?? 0) + 1);
  }
  for (const node of nodes) {
    if (node.isRoot) continue;
    const incoming = edges.filter((e) => e.targetNodeId === node.id);
    if (incoming.length === 0) {
      result.set(node.id, "no-incoming");
    } else if (incoming.every((e) => isMissingSortingQuestion(e.sortingQuestion))) {
      result.set(node.id, "all-invalid");
    } else {
      const isLeaf = (outgoingCount.get(node.id) ?? 0) === 0;
      if (isLeaf && (!node.isVisibleCategory || !node.canReceiveEmails)) {
        result.set(node.id, "invalid-leaf");
      }
    }
  }
  return result;
}
