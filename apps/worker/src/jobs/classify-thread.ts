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
      const { workspaceId, emailThreadId, triageOnly = false } = job.data;

      console.log(
        `[classify-thread] Job ${job.id} received — thread ${emailThreadId} (workspace ${workspaceId})${triageOnly ? " [triage-only]" : ""}`,
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
      if (!connection)
        throw new Error(`No Gmail connection for workspace: ${workspaceId}`);

      try {
        // ── 1b. Mark thread as actively classifying ─────────────────────────
        //
        // Inside the try so the finally block is guaranteed to clear it.
        // If the worker crashes without running finally, the API treats
        // classifyingAt older than 15 minutes as stale (isClassifying=false)
        // but still uses it for isQueued=true until the failed handler clears
        // it after all retries are exhausted.

        await db.emailThread.update({
          where: { id: emailThreadId },
          data: { classifyingAt: new Date() },
        });
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

        const aiProvider = createAIProvider(getAIProviderConfig());

        if (triageOnly) {
          // ── Triage-only path ──────────────────────────────────────────────────
          //
          // Skip routing entirely. Re-run the triage metadata analysis and update
          // the most recent existing classification record. triageStatus is left
          // unchanged — the user is satisfied with the routing result.

          const existingClassification = await db.emailClassification.findFirst({
            where: { emailThreadId, workspaceId },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });

          if (!existingClassification) {
            throw new Error(
              `No existing classification for thread ${emailThreadId} — sort first before re-analyzing`
            );
          }

          await job.updateProgress(40);

          const triage = await analyzeThreadTriage(aiProvider, messages);

          if (triage === null) {
            // Unlike the full classification path where routing already
            // succeeded and triage is supplementary, triage-only has no
            // fallback — the entire purpose of the job was to get metadata.
            // Throw so BullMQ retries and the classifying indicator stays
            // active rather than silently disappearing with no result.
            throw new Error(
              `Triage analysis returned null for thread ${emailThreadId} — LLM failed or returned invalid output`
            );
          }

          await db.emailClassification.update({
            where: { id: existingClassification.id },
            data: {
              priority: triage.priority,
              urgency: triage.urgency,
              riskLevel: triage.riskLevel,
              requiredAction: triage.requiredAction,
              sensitivity: triage.sensitivity,
              dueAt: triage.dueAt !== null ? new Date(triage.dueAt) : null,
              suggestedNextStep: triage.suggestedNextStep,
            },
          });
          console.log(
            `[classify-thread] Triage-only metadata saved for thread ${emailThreadId}: priority=${triage.priority}, urgency=${triage.urgency}`
          );

          await job.updateProgress(95);
        } else {
          // ── Full classification path ──────────────────────────────────────────

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

          // ── 4. Route via embeddings ─────────────────────────────────────────────
          //
          // Run routing then triage sequentially — Ollama processes requests
          // serially; concurrent calls queue and can exceed the 5-minute headers
          // timeout. For API-based frontier LLMs this is not a concern.

          const embeddingProvider = createEmbeddingProvider(
            getEmbeddingProviderConfig(),
          );

          const result = await sortThreadByEmbedding(
            embeddingProvider,
            aiProvider,
            nodes,
            rawEdges,
            messages,
          );

          await job.updateProgress(60);

          // ── 5. Persist updated node embedding cache ───────────────────────────

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

          // ── 6. Persist routing result + update thread status ──────────────────
          //
          // Done before triage so the UI can distinguish the two phases:
          //   classifyingAt set  + no classification  → "Sorting…"   (routing)
          //   classifyingAt set  + classification exists → "Analyzing…" (triage)
          //   classifyingAt null + classification exists → done

          const { id: classificationId } = await db.emailClassification.create({
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

          await db.emailThread.update({
            where: { id: emailThreadId },
            data: { triageStatus: result.needsHumanReview ? "NEEDS_REVIEW" : "SORTED" },
          });

          await job.updateProgress(75);

          // ── 7. Triage metadata ────────────────────────────────────────────────
          //
          // Non-fatal — thread is already sorted; triage fields are left null
          // if the LLM fails or returns invalid output.

          const triage = await analyzeThreadTriage(aiProvider, messages);

          if (triage !== null) {
            await db.emailClassification.update({
              where: { id: classificationId },
              data: {
                priority: triage.priority,
                urgency: triage.urgency,
                riskLevel: triage.riskLevel,
                requiredAction: triage.requiredAction,
                sensitivity: triage.sensitivity,
                dueAt: triage.dueAt !== null ? new Date(triage.dueAt) : null,
                suggestedNextStep: triage.suggestedNextStep,
              },
            });
            console.log(
              `[classify-thread] Triage metadata saved for thread ${emailThreadId}: priority=${triage.priority}, urgency=${triage.urgency}`
            );
          } else {
            console.error(
              `[classify-thread] Triage returned null for thread ${emailThreadId} — metadata not saved`
            );
          }

          await job.updateProgress(95);
        }

        await job.updateProgress(100);
      } catch (err) {
        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;
        const remaining = maxAttempts - attempt;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[classify-thread] Failed attempt ${attempt}/${maxAttempts} for thread ${emailThreadId} (workspace ${workspaceId}): ${msg}`,
          remaining > 0
            ? `— ${remaining} retry attempt(s) left`
            : "— no retries left",
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
      // Ollama processes requests serially — a single slow model inference
      // (30-120 s) blocks every concurrent HTTP request queued behind it.
      // With concurrency > 1, the last job in line easily exceeds the
      // 5-minute headers timeout before Ollama even starts responding.
      // For frontier LLM APIs (OpenAI, Anthropic) that handle parallel
      // requests natively, higher concurrency is fine.
      concurrency: (process.env["AI_PROVIDER"] ?? "mock") === "ollama" ? 1 : 5,
      // LLM + embedding calls can take several minutes with local Ollama.
      // The lock auto-renews every lockDuration/2 ms while the job is running,
      // so 5 minutes covers even the slowest models without false stalls.
      lockDuration: 300_000,
      // Tolerate up to 3 stalls (e.g. dev-server hot-reloads) before
      // permanently failing a job.  Classification is idempotent so retrying
      // a stalled job is always safe.
      maxStalledCount: 3,
    },
  );

  // When a job is permanently failed (all retries exhausted), the finally
  // block in the processor may not have run (e.g. the job stalled because the
  // worker process was killed). Clear classifyingAt here so the thread is not
  // stuck showing "Queued" in the UI indefinitely.
  worker.on("failed", (job, err) => {
    if (!job) return;
    const { workspaceId, emailThreadId } = job.data;
    console.error(
      `[classify-thread] Permanently failed for thread ${emailThreadId} (workspace ${workspaceId}) after ${job.attemptsMade} attempt(s):`,
      err,
    );
    db.emailThread
      .update({
        where: { id: emailThreadId },
        data: { classifyingAt: null },
      })
      .catch(() => {
        // Best-effort — don't mask the original error.
      });
  });

  return worker;
}
