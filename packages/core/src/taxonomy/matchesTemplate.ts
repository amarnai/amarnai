import type { TaxonomyTemplate } from "./templates.js";

// Minimal structural shapes so this works for both the @amarnai/shared and
// @amarnai/api-client taxonomy node/edge types without coupling to either.
type MatchNode = { id: string; name: string };
type MatchEdge = { sourceNodeId: string; targetNodeId: string };

/**
 * True when the current taxonomy is structurally identical to a template: same
 * node names and the same parent→child relationships (compared by name, since DB
 * ids differ from the template's refs). Used to mark the active template so it
 * cannot be re-applied.
 */
export function matchesTemplate(
  dbNodes: readonly MatchNode[],
  dbEdges: readonly MatchEdge[],
  template: TaxonomyTemplate,
): boolean {
  const { nodes: tNodes, edges: tEdges } = template.file;
  if (dbNodes.length !== tNodes.length || dbEdges.length !== tEdges.length) {
    return false;
  }

  const dbNames = dbNodes.map((n) => n.name).sort();
  const tNames = tNodes.map((n) => n.name).sort();
  if (dbNames.some((n, i) => n !== tNames[i])) return false;

  const dbIdToName = new Map(dbNodes.map((n) => [n.id, n.name]));
  const tRefToName = new Map(tNodes.map((n) => [n.ref, n.name]));
  const dbEdgeSet = new Set(
    dbEdges.map(
      (e) => `${dbIdToName.get(e.sourceNodeId)}→${dbIdToName.get(e.targetNodeId)}`,
    ),
  );
  return tEdges.every((e) =>
    dbEdgeSet.has(`${tRefToName.get(e.sourceRef)}→${tRefToName.get(e.targetRef)}`),
  );
}
