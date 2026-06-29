/**
 * Shared helpers for the Batch-API backfill routing pass (BACKFILL_BATCH_MODE).
 */
import { db } from "@amarnai/db";
import {
  getStaleEmbeddableNodes,
  buildNodeEmbeddingText,
  deriveBreadcrumb,
  hashEmbeddingInput,
} from "@amarnai/ai";
import type { EmbeddableNode, EmbeddingProvider, TaxonomyEdgeInput } from "@amarnai/ai";
import { isTaxonomyRoutable } from "@amarnai/shared";
import { classifyThreadQueue } from "../queues.js";

export { buildBatchKey, parseBatchKey } from "./batch-key.js";

export type RoutableTaxonomy = {
  nodes: EmbeddableNode[];
  edges: TaxonomyEdgeInput[];
  rootNodeId: string | null;
};

/** Load the workspace taxonomy as EmbeddableNodes; null when not routable. */
export async function loadRoutableTaxonomy(workspaceId: string): Promise<RoutableTaxonomy | null> {
  const [rawNodes, rawEdges] = await Promise.all([
    db.taxonomyNode.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        description: true,
        instructions: true,
        examples: true,
        isRoot: true,
        isCatchAll: true,
        embeddingVector: true,
        embeddingModel: true,
        embeddingTextHash: true,
      },
    }),
    db.taxonomyEdge.findMany({
      where: { workspaceId },
      select: { id: true, sourceNodeId: true, targetNodeId: true },
    }),
  ]);

  if (!isTaxonomyRoutable(rawNodes, rawEdges)) return null;

  const nodes: EmbeddableNode[] = rawNodes.map((n) => ({
    ...n,
    examples: n.examples as string[],
    embeddingVector: n.embeddingVector.length > 0 ? n.embeddingVector : null,
  }));
  return { nodes, edges: rawEdges, rootNodeId: rawNodes.find((n) => n.isRoot)?.id ?? null };
}

/**
 * Refresh stale taxonomy node embeddings ONCE before the routing pass so the
 * offline sort never triggers synchronous node embeds per thread (cold start /
 * post-edit). Mutates `nodes` in place with the fresh vectors and persists them.
 */
export async function prewarmNodeEmbeddings(
  nodes: EmbeddableNode[],
  edges: TaxonomyEdgeInput[],
  embeddingProvider: EmbeddingProvider,
): Promise<void> {
  const model = embeddingProvider.modelName;
  const stale = getStaleEmbeddableNodes(nodes, edges, model);
  if (stale.length === 0) return;

  const texts = stale.map((n) =>
    buildNodeEmbeddingText({
      name: n.name,
      description: n.description!,
      breadcrumb: deriveBreadcrumb(n.id, nodes, edges),
    }),
  );
  const vectors = await embeddingProvider.embed(texts);
  const now = new Date();
  await Promise.all(
    stale.map(async (n, i) => {
      const vector = vectors[i];
      if (!vector || vector.length === 0) return;
      const textHash = hashEmbeddingInput(texts[i]!, model);
      n.embeddingVector = vector;
      n.embeddingModel = model;
      n.embeddingTextHash = textHash;
      await db.taxonomyNode.update({
        where: { id: n.id },
        data: {
          embeddingVector: vector,
          embeddingModel: model,
          embeddingTextHash: textHash,
          embeddingUpdatedAt: now,
        },
      });
    }),
  );
}

/**
 * Drop threads out of the batch pipeline and back onto the synchronous path:
 * mark their BatchThreadState FAILED, reset the thread to PENDING, and enqueue a
 * BACKFILL classify-thread job. Used for batch/per-request failures, expiry, and
 * the content-changed consistency guard. Never strands a thread.
 */
export async function fallbackThreadsToOnline(
  workspaceId: string,
  emailThreadIds: string[],
): Promise<void> {
  if (emailThreadIds.length === 0) return;
  console.warn(
    `[batch-fallback] ws=${workspaceId} routing ${emailThreadIds.length} thread(s) back to the synchronous classify-thread path`,
  );
  await db.batchThreadState.updateMany({
    where: { emailThreadId: { in: emailThreadIds } },
    data: { status: "FAILED" },
  });
  await db.emailThread.updateMany({
    where: { id: { in: emailThreadIds }, workspaceId },
    data: { triageStatus: "PENDING", classifyingAt: new Date() },
  });
  await classifyThreadQueue.addBulk(
    emailThreadIds.map((emailThreadId) => ({
      name: "classify-thread",
      data: { workspaceId, emailThreadId, source: "BACKFILL" as const },
      opts: {
        deduplication: { id: `classify_batch_fallback_${workspaceId}_${emailThreadId}` },
        priority: 10,
      },
    })),
  );
}
