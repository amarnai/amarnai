import { Worker } from "bullmq";
import { db } from "@amarnai/db";
import {
  createAIProvider,
  createEmbeddingProvider,
  sortThreadByEmbedding,
  snapshotToThreadMessages,
} from "@amarnai/ai";
import type { EmbeddableNode } from "@amarnai/ai";
import { GmailClient, normalizeGmailThread } from "@amarnai/gmail";
import {
  QUEUE_CLASSIFY_THREAD,
  type ClassifyThreadJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import { getAIProviderConfig, getEmbeddingProviderConfig } from "../providers.js";

export function createClassifyThreadWorker(): Worker {
  return new Worker<ClassifyThreadJobData>(
    QUEUE_CLASSIFY_THREAD,
    async (job) => {
      const { workspaceId, emailThreadId } = job.data;

      // ── 1. Load thread + linked account ────────────────────────────────────
      //
      // We need the providerThreadId to re-fetch from Gmail and the account's
      // refresh token to construct a GmailClient. Body text is never stored in
      // the DB (privacy policy), so every classification run re-fetches the
      // thread to obtain the content for the AI.

      const thread = await db.emailThread.findFirst({
        where: { id: emailThreadId, workspaceId },
        select: {
          providerThreadId: true,
          emailAccount: {
            select: { refreshTokenEncrypted: true },
          },
        },
      });

      if (!thread) throw new Error(`EmailThread not found: ${emailThreadId}`);

      // ── 1b. Mark thread as actively classifying ─────────────────────────────
      //
      // Cleared in the finally block regardless of success or failure.
      // If the worker crashes without running finally, the API treats
      // classifyingAt older than 2 minutes as stale and ignores it.

      await db.emailThread.update({
        where: { id: emailThreadId },
        data: { classifyingAt: new Date() },
      });

      try {

      // ── 2. Re-fetch thread from Gmail ───────────────────────────────────────

      const client = new GmailClient(thread.emailAccount.refreshTokenEncrypted);

      let rawThread: unknown;
      try {
        rawThread = await client.getThread(thread.providerThreadId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Thread deleted from Gmail after we enqueued the job — nothing to do.
        if (msg.includes("not found")) return;
        throw err;
      }

      const snapshot = normalizeGmailThread(rawThread);
      if (snapshot.messages.length === 0) return;

      const messages = snapshotToThreadMessages(snapshot);

      await job.updateProgress(20);

      // ── 3. Load taxonomy ────────────────────────────────────────────────────

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

      if (rawNodes.length === 0) {
        throw new Error(`No taxonomy nodes for workspace: ${workspaceId}`);
      }

      const nodes: EmbeddableNode[] = rawNodes.map((n) => ({
        ...n,
        examples: n.examples as string[],
        embeddingVector: n.embeddingVector.length > 0 ? n.embeddingVector : null,
      }));

      await job.updateProgress(35);

      // ── 4. Run AI classification ────────────────────────────────────────────

      const aiProvider = createAIProvider(getAIProviderConfig());
      const embeddingProvider = createEmbeddingProvider(getEmbeddingProviderConfig());

      const result = await sortThreadByEmbedding(
        embeddingProvider,
        aiProvider,
        nodes,
        rawEdges,
        messages
      );

      await job.updateProgress(80);

      // ── 5. Persist updated node embedding cache ─────────────────────────────

      if (result.updatedNodeEmbeddings.length > 0) {
        await Promise.all(
          result.updatedNodeEmbeddings.map((e) =>
            db.taxonomyNode.update({
              where: { id: e.nodeId },
              data: {
                embeddingVector: e.embeddingVector,
                embeddingModel: e.embeddingModel,
                embeddingTextHash: e.embeddingTextHash,
                embeddingUpdatedAt: e.embeddingUpdatedAt,
              },
            })
          )
        );
      }

      // ── 6. Persist classification record ────────────────────────────────────

      await db.emailClassification.create({
        data: {
          workspaceId,
          emailThreadId,
          finalNodeId: result.finalNodeId,
          confidence: result.confidence,
          explanation: result.explanation,
          needsHumanReview: result.needsHumanReview,
          modelProvider: aiProvider.providerName,
          modelName: aiProvider.modelName,
        },
        select: { id: true },
      });

      // ── 7. Update triage status and clear classifying flag ─────────────────

      await db.emailThread.update({
        where: { id: emailThreadId },
        data: {
          triageStatus: result.needsHumanReview ? "NEEDS_REVIEW" : "SORTED",
          classifyingAt: null,
        },
      });

      await job.updateProgress(100);

      } finally {
        // Ensure classifyingAt is always cleared, even on error/early return.
        await db.emailThread.update({
          where: { id: emailThreadId },
          data: { classifyingAt: null },
        }).catch(() => {
          // Best-effort — don't mask the original error.
        });
      }
    },
    {
      connection: redisConnection,
      // Up to 5 classification runs in parallel — bounded by LLM/embedding
      // rate limits rather than by CPU.
      concurrency: 5,
    }
  );
}
