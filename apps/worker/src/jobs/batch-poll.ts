/**
 * `batch-poll` worker (BACKFILL_BATCH_MODE).
 *
 * Watches one submitted Gemini batch (an AiBatchJob row). Re-enqueues itself with
 * a delay until the batch settles, then ingests results:
 *   - EMBED  → writes thread vectors (status ROUTING), enqueues route-batch.
 *   - LLM    → appends escalation answers by step (status ROUTING), enqueues
 *              route-batch for the next routing round.
 * Per-request failures, whole-batch FAILED/EXPIRED, and a poll-attempt ceiling
 * all fall the affected threads back to the synchronous classify-thread path.
 * Idempotent: a COMPLETED/EXPIRED batch is never re-ingested.
 *
 * Observability: every decision logs with a `ws=/job=/kind=` tag, and any
 * poll/ingest error is persisted to AiBatchJob.errorMessage so a stuck or failed
 * batch is diagnosable straight from the DB. On permanent BullMQ failure the
 * `failed` handler marks the batch FAILED and falls its threads back online so a
 * wedged poller never strands them.
 */
import { Worker, type Job } from "bullmq";
import { db } from "@amarnai/db";
import { createBatchProvider, getBatchProviderConfig } from "@amarnai/ai";
import { QUEUE_BATCH_POLL, batchPollQueue, routeBatchQueue, type BatchPollJobData } from "../queues.js";
import { redisConnection } from "../redis.js";
import { fallbackThreadsToOnline } from "./batch-routing-helpers.js";
import { parseBatchKey } from "./batch-key.js";

const POLL_DELAY_MS = 120_000;
/** Secondary guard; the real bound is AiBatchJob.expiresAt. */
const MAX_POLL_ATTEMPTS = 1_000;

/** Truncate a provider error so it fits comfortably in the errorMessage column. */
function clip(msg: string): string {
  return msg.length > 1_000 ? `${msg.slice(0, 1_000)}…` : msg;
}

async function fallbackWholeBatch(
  batchJob: { id: string; workspaceId: string; kind: "EMBED" | "LLM" },
  reason: string,
): Promise<void> {
  const states = await db.batchThreadState.findMany({
    where:
      batchJob.kind === "EMBED"
        ? { embedBatchId: batchJob.id, status: "EMBED_PENDING" }
        : { llmBatchId: batchJob.id, status: "LLM_PENDING" },
    select: { emailThreadId: true },
  });
  console.warn(
    `[batch-poll] ws=${batchJob.workspaceId} job=${batchJob.id} kind=${batchJob.kind} ${reason} — falling ${states.length} thread(s) back online`,
  );
  await fallbackThreadsToOnline(batchJob.workspaceId, states.map((s) => s.emailThreadId));
}

export function createBatchPollWorker(): Worker {
  const worker = new Worker<BatchPollJobData>(
    QUEUE_BATCH_POLL,
    async (job) => {
      const { workspaceId, batchJobId } = job.data;
      const tag = `[batch-poll] ws=${workspaceId} job=${batchJobId}`;

      const batchJob = await db.aiBatchJob.findUnique({ where: { id: batchJobId } });
      if (!batchJob) {
        console.warn(`${tag} no AiBatchJob row — skipping`);
        return;
      }
      if (batchJob.status === "COMPLETED" || batchJob.status === "EXPIRED" || batchJob.status === "FAILED") {
        console.log(`${tag} already terminal (${batchJob.status}) — skipping`);
        return;
      }
      if (!batchJob.providerJobId) {
        console.warn(`${tag} no providerJobId (submit never completed) — skipping`);
        return;
      }

      const kind = batchJob.kind as "EMBED" | "LLM";

      // Expiry: a wedged batch trips EXPIRED and its threads fall back online.
      if (Date.now() > batchJob.expiresAt.getTime()) {
        await db.aiBatchJob.update({
          where: { id: batchJob.id },
          data: { status: "EXPIRED", errorMessage: clip(`expired at ${new Date().toISOString()} after ${batchJob.pollAttempts} poll(s)`) },
        });
        await fallbackWholeBatch({ id: batchJob.id, workspaceId, kind }, "past expiresAt");
        return;
      }

      try {
        const provider = createBatchProvider(getBatchProviderConfig());
        const status = await provider.poll(batchJob.providerJobId);
        await db.aiBatchJob.update({
          where: { id: batchJob.id },
          data: { polledAt: new Date(), pollAttempts: { increment: 1 } },
        });

        if (status === "RUNNING") {
          console.log(`${tag} kind=${kind} provider=${batchJob.providerJobId} still RUNNING (poll ${batchJob.pollAttempts + 1})`);
          if (batchJob.pollAttempts + 1 >= MAX_POLL_ATTEMPTS) {
            await db.aiBatchJob.update({
              where: { id: batchJob.id },
              data: { status: "EXPIRED", errorMessage: clip(`hit MAX_POLL_ATTEMPTS (${MAX_POLL_ATTEMPTS})`) },
            });
            await fallbackWholeBatch({ id: batchJob.id, workspaceId, kind }, "max poll attempts");
            return;
          }
          await batchPollQueue.add(
            "batch-poll",
            { workspaceId, batchJobId },
            { deduplication: { id: `batch_poll_${workspaceId}_${batchJobId}` }, delay: POLL_DELAY_MS },
          );
          return;
        }

        if (status === "FAILED" || status === "EXPIRED") {
          await db.aiBatchJob.update({
            where: { id: batchJob.id },
            data: { status, errorMessage: clip(`provider reported ${status}`) },
          });
          await fallbackWholeBatch({ id: batchJob.id, workspaceId, kind }, `provider ${status}`);
          return;
        }

        // COMPLETED — ingest and hand off to route-batch.
        const failed: string[] = [];
        let ok = 0;
        let foreign = 0;
        if (kind === "EMBED") {
          const { items, inputTokens, outputTokens } = await provider.fetchEmbeddingResults(batchJob.providerJobId);
          for (const item of items) {
            const parsed = parseBatchKey(item.key);
            if (parsed.workspaceId !== workspaceId) {
              foreign++;
              continue; // tenant-isolation guard
            }
            if (!item.vector || item.vector.length === 0) {
              failed.push(parsed.emailThreadId);
              continue;
            }
            await db.batchThreadState.updateMany({
              where: { emailThreadId: parsed.emailThreadId, embedBatchId: batchJob.id },
              data: { threadVector: item.vector, status: "ROUTING" },
            });
            ok++;
          }
          await db.aiBatchJob.update({
            where: { id: batchJob.id },
            data: { status: "COMPLETED", completedAt: new Date(), inputTokens, outputTokens },
          });
          console.log(
            `${tag} EMBED COMPLETED: ${items.length} result(s) → ${ok} vector(s), ${failed.length} failed, ${foreign} foreign-key; tokens in=${inputTokens}`,
          );
        } else {
          const { items, inputTokens, outputTokens } = await provider.fetchGenerateResults(batchJob.providerJobId);
          for (const item of items) {
            const parsed = parseBatchKey(item.key);
            if (parsed.workspaceId !== workspaceId || !parsed.step) {
              foreign++;
              continue;
            }
            const state = await db.batchThreadState.findUnique({ where: { emailThreadId: parsed.emailThreadId } });
            if (!state || state.llmBatchId !== batchJob.id) continue;
            if (!item.output) {
              failed.push(parsed.emailThreadId);
              continue;
            }
            const answers = { ...((state.llmAnswers as Record<string, string>) ?? {}), [parsed.step]: item.output };
            await db.batchThreadState.update({
              where: { emailThreadId: parsed.emailThreadId },
              // Back to ROUTING so route-batch replays the answer next round.
              data: { llmAnswers: answers, status: "ROUTING" },
            });
            ok++;
          }
          await db.aiBatchJob.update({
            where: { id: batchJob.id },
            data: { status: "COMPLETED", completedAt: new Date(), inputTokens, outputTokens },
          });
          console.log(
            `${tag} LLM COMPLETED: ${items.length} result(s) → ${ok} answer(s), ${failed.length} failed, ${foreign} foreign-key; tokens in=${inputTokens} out=${outputTokens}`,
          );
        }

        if (foreign > 0) {
          console.warn(`${tag} ${foreign} result(s) had a foreign workspace key — dropped (tenant isolation)`);
        }
        if (failed.length > 0) {
          console.warn(`${tag} ${failed.length} per-request failure(s) — falling back online`);
          await fallbackThreadsToOnline(workspaceId, failed);
        }

        await routeBatchQueue.add(
          "route-batch",
          { workspaceId, emailAccountId: batchJob.emailAccountId },
          { deduplication: { id: `route_batch_${workspaceId}` } },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} kind=${kind} poll/ingest error: ${msg}`);
        // Persist the latest error so a stuck batch is diagnosable from the DB,
        // then rethrow so BullMQ retries (the `failed` handler below handles the
        // permanent case after attempts are exhausted).
        await db.aiBatchJob
          .update({ where: { id: batchJob.id }, data: { errorMessage: clip(msg) } })
          .catch(() => {});
        throw err;
      }
    },
    { connection: redisConnection, concurrency: 5 },
  );

  // Permanent failure (all retries exhausted): mark the batch FAILED and fall its
  // threads back online so a wedged poll never leaves them stuck in *_PENDING.
  worker.on("failed", (job: Job<BatchPollJobData> | undefined, err: Error) => {
    if (!job) return;
    // Only act once retries are exhausted — "failed" can fire per attempt.
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const { workspaceId, batchJobId } = job.data;
    console.error(
      `[batch-poll] ws=${workspaceId} job=${batchJobId} permanently failed after ${job.attemptsMade} attempt(s): ${err.message}`,
    );
    void (async () => {
      const batchJob = await db.aiBatchJob.findUnique({ where: { id: batchJobId } }).catch(() => null);
      if (!batchJob || batchJob.status === "COMPLETED") return;
      await db.aiBatchJob
        .update({ where: { id: batchJobId }, data: { status: "FAILED", errorMessage: clip(`poll permanently failed: ${err.message}`) } })
        .catch(() => {});
      await fallbackWholeBatch(
        { id: batchJobId, workspaceId, kind: batchJob.kind as "EMBED" | "LLM" },
        "poll permanently failed",
      ).catch(() => {});
    })();
  });

  return worker;
}
