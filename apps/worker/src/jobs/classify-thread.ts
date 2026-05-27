import { Worker } from "bullmq";
import { db } from "@amarnai/db";
import {
  createAIProvider,
  createEmbeddingProvider,
  sortThreadByEmbedding,
  analyzeThreadTriage,
  snapshotToThreadMessages,
} from "@amarnai/ai";
import type { EmbeddableNode } from "@amarnai/ai";
import { GmailClient, normalizeGmailThread } from "@amarnai/gmail";
import {
  QUEUE_CLASSIFY_THREAD,
  type ClassifyThreadJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import {
  getAIProviderConfig,
  getEmbeddingProviderConfig,
} from "../providers.js";

export function createClassifyThreadWorker(): Worker {
  const worker = new Worker<ClassifyThreadJobData>(
    QUEUE_CLASSIFY_THREAD,
    async (job) => {
      const { workspaceId, emailThreadId } = job.data;

      console.log(
        `[classify-thread] Job ${job.id} received — thread ${emailThreadId} (workspace ${workspaceId})`
      );

      // ── 1. Load thread + Gmail connection ──────────────────────────────────
      //
      // GmailConnection.encryptedRefreshToken is the authoritative token source —
      // always kept fresh by the OAuth callback. EmailAccount.refreshTokenEncrypted
      // is only written on first create (update: {}) and can become stale after a
      // token rotation or key change, so we do not use it here.

      const [thread, connection] = await Promise.all([
        db.emailThread.findFirst({
          where: { id: emailThreadId, workspaceId },
          select: { providerThreadId: true },
        }),
        db.gmailConnection.findUnique({
          where: { workspaceId },
          select: { encryptedRefreshToken: true },
        }),
      ]);

      if (!thread) throw new Error(`EmailThread not found: ${emailThreadId}`);
      if (!connection) throw new Error(`No Gmail connection for workspace: ${workspaceId}`);

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

        const client = new GmailClient(connection.encryptedRefreshToken);

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
          embeddingVector:
            n.embeddingVector.length > 0 ? n.embeddingVector : null,
        }));

        await job.updateProgress(35);

        // ── 4. Run AI classification ────────────────────────────────────────────

        const aiProvider = createAIProvider(getAIProviderConfig());
        const embeddingProvider = createEmbeddingProvider(
          getEmbeddingProviderConfig(),
        );

        // Run routing and triage metadata analysis concurrently — they are
        // independent: routing selects a taxonomy node, triage describes the
        // email's priority/urgency/risk/action. A triage failure (null) is
        // non-fatal and leaves those columns unpopulated.
        const [result, triage] = await Promise.all([
          sortThreadByEmbedding(
            embeddingProvider,
            aiProvider,
            nodes,
            rawEdges,
            messages,
          ),
          analyzeThreadTriage(aiProvider, messages),
        ]);

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
              }),
            ),
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
            // Triage metadata — populated only when the LLM returned valid output.
            ...(triage !== null && {
              priority: triage.priority,
              urgency: triage.urgency,
              riskLevel: triage.riskLevel,
              requiredAction: triage.requiredAction,
              sensitivity: triage.sensitivity,
              dueAt: triage.dueAt !== null ? new Date(triage.dueAt) : null,
              suggestedNextStep: triage.suggestedNextStep,
            }),
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
      } catch (err) {
        const attempt = job.attemptsMade + 1;
        const maxAttempts = (job.opts.attempts ?? 1);
        const remaining = maxAttempts - attempt;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[classify-thread] Failed attempt ${attempt}/${maxAttempts} for thread ${emailThreadId} (workspace ${workspaceId}): ${msg}`,
          remaining > 0 ? `— ${remaining} retry attempt(s) left` : "— no retries left",
        );
        throw err;
      } finally {
        // Ensure classifyingAt is always cleared, even on error/early return.
        await db.emailThread
          .update({
            where: { id: emailThreadId },
            data: { classifyingAt: null },
          })
          .catch(() => {
            // Best-effort — don't mask the original error.
          });
      }
    },
    {
      connection: redisConnection,
      // Up to 5 classification runs in parallel — bounded by LLM/embedding
      // rate limits rather than by CPU.
      concurrency: 5,
    },
  );

  // Log definitively when all retry attempts are exhausted.
  worker.on("failed", (job, err) => {
    if (!job) return;
    const { workspaceId, emailThreadId } = job.data;
    console.error(
      `[classify-thread] Permanently failed for thread ${emailThreadId} (workspace ${workspaceId}) after ${job.attemptsMade} attempt(s):`,
      err,
    );
  });

  return worker;
}
