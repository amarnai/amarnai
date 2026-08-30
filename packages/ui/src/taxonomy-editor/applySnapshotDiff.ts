import type { ApiClient, TaxonomyNode } from "@aziru/api-client";
import { snapshotsEqual, type GraphSnapshot } from "@aziru/core/taxonomy";

/**
 * Every field the replay below writes. A field compared here but absent from the
 * payloads would make undo report success while silently discarding the change;
 * a field in the payloads but not compared here would never be undone at all.
 */
export function nodesIdentical(a: TaxonomyNode, b: TaxonomyNode): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.instructions === b.instructions &&
    a.draftPrompt === b.draftPrompt &&
    a.colorKey === b.colorKey &&
    a.positionX === b.positionX &&
    a.positionY === b.positionY &&
    JSON.stringify(a.examples) === JSON.stringify(b.examples)
  );
}

/**
 * Replays the difference between two graph snapshots against the server, which
 * is how undo and redo are applied: there is no transactional "restore this
 * graph" endpoint, so the change is reconstructed as ordered CRUD.
 *
 * Order matters. Edges are removed before the nodes they point at, and nodes are
 * created before the edges that reference them.
 */
export async function applySnapshotDiff(
  api: ApiClient,
  from: GraphSnapshot,
  to: GraphSnapshot,
  workspaceId: string
): Promise<void> {
  if (snapshotsEqual(from, to)) return;

  const fromNodeMap = new Map(from.nodes.map((n) => [n.id, n]));
  const toNodeMap = new Map(to.nodes.map((n) => [n.id, n]));
  const fromEdgeMap = new Map(from.edges.map((e) => [e.id, e]));
  const toEdgeMap = new Map(to.edges.map((e) => [e.id, e]));

  // 1. Delete edges no longer in target (before deleting nodes).
  for (const id of fromEdgeMap.keys()) {
    if (!toEdgeMap.has(id)) {
      await api.deleteTaxonomyEdge(workspaceId, id);
    }
  }

  // 2. Delete nodes no longer in target (root nodes are never deleted).
  for (const [id, fromNode] of fromNodeMap) {
    if (!toNodeMap.has(id) && !fromNode.isRoot) {
      await api.deleteTaxonomyNode(workspaceId, id);
    }
  }

  // 3. Create nodes that exist in target but not in source.
  //
  // A re-created node gets a NEW server id, so the snapshot's id is dead from
  // here on. Record old -> new; step 4 needs it, because the edges in the target
  // snapshot still name the old ids and would otherwise be created against rows
  // that no longer exist (undoing a delete would restore the folder but leave it
  // detached from its parent).
  const recreatedIds = new Map<string, string>();
  for (const [id, toNode] of toNodeMap) {
    if (!fromNodeMap.has(id) && !toNode.isRoot) {
      const created = await api.createTaxonomyNode(workspaceId, {
        name: toNode.name,
        ...(toNode.description ? { description: toNode.description } : {}),
        instructions: toNode.instructions,
        draftPrompt: toNode.draftPrompt,
        colorKey: toNode.colorKey,
        examples: toNode.examples,
        positionX: toNode.positionX,
        positionY: toNode.positionY,
      });
      recreatedIds.set(id, created.id);
    }
  }

  const liveId = (snapshotId: string) => recreatedIds.get(snapshotId) ?? snapshotId;

  // 4. Create edges that exist in target but not in source.
  for (const [id, toEdge] of toEdgeMap) {
    if (!fromEdgeMap.has(id)) {
      await api.createTaxonomyEdge(workspaceId, {
        sourceNodeId: liveId(toEdge.sourceNodeId),
        targetNodeId: liveId(toEdge.targetNodeId),
      });
    }
  }

  // 5. Update nodes that exist in both but have changed fields.
  for (const [id, toNode] of toNodeMap) {
    const fromNode = fromNodeMap.get(id);
    if (fromNode && !nodesIdentical(fromNode, toNode)) {
      await api.updateTaxonomyNode(workspaceId, id, {
        name: toNode.name,
        ...(toNode.description ? { description: toNode.description } : {}),
        instructions: toNode.instructions,
        draftPrompt: toNode.draftPrompt,
        colorKey: toNode.colorKey,
        examples: toNode.examples,
        positionX: toNode.positionX,
        positionY: toNode.positionY,
      });
    }
  }
}
