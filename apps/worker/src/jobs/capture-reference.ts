import { Worker } from "bullmq";
import { db } from "@aziru/db";
import {
  createEmbeddingProvider,
  getEmbeddingProviderConfig,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
} from "@aziru/ai";
import { MAX_REFERENCES_PER_NODE } from "@aziru/shared";
import {
  QUEUE_CAPTURE_REFERENCE,
  type CaptureReferenceJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import {
  buildEmbeddingCacheKey,
  memoizeAcrossRetries,
  parseVector,
  THREAD_EMBEDDING_TTL_SECONDS,
} from "../ai-dedup.js";

/**
 * Fills the embedding vector of a manually moved thread's TaxonomyNodeReference
 * row, then prunes the destination node's references to the retention cap.
 *
 * The thread text is built from PERSISTED EmailMessage rows — no provider
 * fetch — so the job is provider-neutral and has no auth failure mode. The
 * message slice mirrors classify-thread's snapshot shape (subject, bodyText,
 * attachment filenames, ordered oldest-first) so the content-addressed Redis
 * embedding cache is shared: a thread moved right after being sorted reuses
 * its vector for free. Embedding-only, no LLM — exempt from the monthly
 * thread-sort quota, like the MOVE classification that created the row.
 *
 * Idempotent under retries and duplicate enqueues:
 *  - row missing (undo retracted it, or a cascade deleted it) → no-op;
 *  - row's embeddingTextHash already matches current content + model → no-op.
 */
export function createCaptureReferenceWorker(): Worker<CaptureReferenceJobData> {
  return new Worker<CaptureReferenceJobData>(
    QUEUE_CAPTURE_REFERENCE,
    async (job) => {
      const { workspaceId, emailThreadId } = job.data;

      const reference = await db.taxonomyNodeReference.findFirst({
        where: { emailThreadId, workspaceId },
        select: { id: true, nodeId: true, embeddingModel: true, embeddingTextHash: true },
      });
      if (!reference) {
        console.log(
          `[capture-reference] No reference row for thread ${emailThreadId} — retracted or deleted, skipping`,
        );
        return;
      }

      const messages = await db.emailMessage.findMany({
        where: { emailThreadId, workspaceId },
        orderBy: { receivedAt: "asc" },
        select: { subject: true, bodyText: true, attachments: true },
      });

      const threadText = buildThreadEmbeddingText(
        messages.map((m) => {
          const attachmentNames = (Array.isArray(m.attachments) ? m.attachments : []).flatMap(
            (a) =>
              a && typeof a === "object" && "filename" in a && typeof a.filename === "string"
                ? [a.filename]
                : [],
          );
          return {
            subject: m.subject,
            bodyText: m.bodyText,
            ...(attachmentNames.length ? { attachmentNames } : {}),
          };
        }),
      );
      if (threadText.trim() === "") {
        // Nothing embeddable (and the sorter could never match it anyway).
        // Delete the pending row rather than leaving it to look retryable.
        await db.taxonomyNodeReference.deleteMany({ where: { id: reference.id } });
        console.log(
          `[capture-reference] Thread ${emailThreadId} has no text content — reference removed`,
        );
        return;
      }

      const embeddingProvider = createEmbeddingProvider(getEmbeddingProviderConfig());
      const textHash = hashEmbeddingInput(threadText, embeddingProvider.modelName);

      if (
        reference.embeddingTextHash === textHash &&
        reference.embeddingModel === embeddingProvider.modelName
      ) {
        return; // Vector already current — retry or duplicate enqueue.
      }

      const vector = await memoizeAcrossRetries<number[]>(
        buildEmbeddingCacheKey(workspaceId, textHash, embeddingProvider.modelName),
        {
          compute: async () => {
            const [v] = await embeddingProvider.embed([threadText]);
            return v ?? [];
          },
          serialize: (v) => JSON.stringify(v),
          deserialize: parseVector,
          shouldCache: (v) => v.length > 0,
        },
        THREAD_EMBEDDING_TTL_SECONDS,
      );
      if (vector.length === 0) {
        throw new Error(
          `Embedding failed for reference thread ${emailThreadId} — retrying`,
        );
      }

      // updateMany, not update: the row may have been retracted while we were
      // embedding (undo race). Zero rows updated is a clean no-op.
      await db.taxonomyNodeReference.updateMany({
        where: { id: reference.id },
        data: {
          embeddingVector: vector,
          embeddingModel: embeddingProvider.modelName,
          embeddingTextHash: textHash,
        },
      });

      // Prune the node's references beyond the retention cap, oldest first.
      // Cheap at the cap size; runs after every capture so the table stays
      // bounded without a separate sweep.
      const keep = await db.taxonomyNodeReference.findMany({
        where: { workspaceId, nodeId: reference.nodeId },
        orderBy: { updatedAt: "desc" },
        take: MAX_REFERENCES_PER_NODE,
        select: { id: true },
      });
      const pruned = await db.taxonomyNodeReference.deleteMany({
        where: {
          workspaceId,
          nodeId: reference.nodeId,
          id: { notIn: keep.map((r) => r.id) },
        },
      });

      console.log(
        `[capture-reference] Captured reference for thread ${emailThreadId} → node ${reference.nodeId}` +
          (pruned.count > 0 ? ` (pruned ${pruned.count})` : ""),
      );
    },
    { connection: redisConnection },
  );
}
