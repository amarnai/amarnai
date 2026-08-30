import type { TaxonomyTransferFile, TaxonomyNode, TaxonomyEdge } from "@aziru/shared";

// workspaceId and timestamps are unused by the canvas renderer; stub them so
// the adapter doesn't need a live workspace context.
const STUB_DATE = "1970-01-01T00:00:00.000Z";

/**
 * Converts a ref-based TaxonomyTransferFile into the id-based TaxonomyNode /
 * TaxonomyEdge arrays expected by ReadOnlyTaxonomyCanvas.
 */
export function transferToDisplayGraph(file: TaxonomyTransferFile): {
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
} {
  const nodes: TaxonomyNode[] = file.nodes.map((n) => ({
    id: n.ref,
    workspaceId: "",
    name: n.name,
    description: n.description,
    instructions: n.instructions,
    draftPrompt: n.draftPrompt,
    examples: n.examples,
    isRoot: n.isRoot,
    isCatchAll: n.isCatchAll,
    positionX: n.positionX,
    positionY: n.positionY,
    createdAt: STUB_DATE,
    updatedAt: STUB_DATE,
  }));

  const edges: TaxonomyEdge[] = file.edges.map((e) => ({
    id: `${e.sourceRef}->${e.targetRef}`,
    workspaceId: "",
    sourceNodeId: e.sourceRef,
    targetNodeId: e.targetRef,
    createdAt: STUB_DATE,
    updatedAt: STUB_DATE,
  }));

  return { nodes, edges };
}
