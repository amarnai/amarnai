/**
 * Submit a per-workspace embedding batch for a chunk of backfilled threads
 * (BACKFILL_BATCH_MODE). Builds the embed text at ingestion (bodies are in hand
 * from processThread — no extra Gmail fetch), records an AiBatchJob + one
 * BatchThreadState per thread, moves those threads to BATCH_PENDING (so the
 * online recovery sweeps never touch them), submits the batch, and enqueues a
 * `batch-poll` watcher.
 *
 * Threads with no embeddable text are excluded and left for the online path.
 */
import { db } from "@amarnai/db";
import { createBatchProvider, getBatchProviderConfig, hashEmbeddingInput } from "@amarnai/ai";
import { batchPollQueue } from "../queues.js";
import { fallbackThreadsToOnline } from "./batch-routing-helpers.js";

/** AiBatchJob expiry: a touch over Gemini's 24h SLA, after which the poller trips EXPIRED. */
const BATCH_EXPIRY_MS = 26 * 60 * 60 * 1_000;

export type EmbedBatchThread = {
  emailThreadId: string;
  /** Pre-built thread embedding text (from ingestion-time bodies). */
  embedText: string;
  messageCount: number;
};

export async function submitEmbedBatch(args: {
  workspaceId: string;
  emailAccountId: string;
  threads: EmbedBatchThread[];
  now: Date;
}): Promise<{ batchJobId: string; submitted: number } | null> {
  const { workspaceId, emailAccountId, threads, now } = args;

  // Drop threads with no embeddable text — they cannot be embedded and would
  // poison the batch. Left PENDING for the online path / manual review.
  const embeddable = threads.filter((t) => t.embedText.trim() !== "");
  if (embeddable.length === 0) return null;

  const provider = createBatchProvider(getBatchProviderConfig());
  const model = provider.embedModelName;

  // 1. Local batch record FIRST (providerJobId null), so a crash after submit can
  //    still be reconciled and a retry never double-submits (unique providerJobId).
  const batchJob = await db.aiBatchJob.create({
    data: {
      workspaceId,
      emailAccountId,
      kind: "EMBED",
      status: "SUBMITTED",
      modelName: model,
      requestCount: embeddable.length,
      expiresAt: new Date(now.getTime() + BATCH_EXPIRY_MS),
    },
    select: { id: true },
  });

  // 2. Per-thread state + move threads to BATCH_PENDING (excluded from recovery).
  await db.$transaction([
    ...embeddable.map((t) =>
      db.batchThreadState.upsert({
        where: { emailThreadId: t.emailThreadId },
        create: {
          workspaceId,
          emailThreadId: t.emailThreadId,
          status: "EMBED_PENDING",
          threadTextHash: hashEmbeddingInput(t.embedText, model),
          bodyHash: hashEmbeddingInput(t.embedText, "thread-body"),
          messageCount: t.messageCount,
          embedBatchId: batchJob.id,
        },
        update: {
          status: "EMBED_PENDING",
          threadTextHash: hashEmbeddingInput(t.embedText, model),
          bodyHash: hashEmbeddingInput(t.embedText, "thread-body"),
          messageCount: t.messageCount,
          embedBatchId: batchJob.id,
          llmBatchId: null,
          llmAnswers: {},
          round: 0,
        },
      }),
    ),
    db.emailThread.updateMany({
      where: { id: { in: embeddable.map((t) => t.emailThreadId) }, workspaceId },
      data: { triageStatus: "BATCH_PENDING", classifyingAt: null },
    }),
  ]);

  // 3. Submit. Key = workspaceId:emailThreadId (one embed per thread). On submit
  //    failure, mark the batch FAILED and revert threads so the online path can
  //    reclaim them (never strand a thread in BATCH_PENDING).
  try {
    const { providerJobId } = await provider.submitEmbeddings(
      // Key = workspaceId|emailThreadId. "|" separates parts because escalation
      // step strings (used by the LLM batch) contain ":".
      embeddable.map((t) => ({ key: `${workspaceId}|${t.emailThreadId}`, text: t.embedText })),
    );
    await db.aiBatchJob.update({
      where: { id: batchJob.id },
      data: { providerJobId, status: "RUNNING" },
    });
    await batchPollQueue.add(
      "batch-poll",
      { workspaceId, batchJobId: batchJob.id },
      {
        deduplication: { id: `batch_poll_${workspaceId}_${batchJob.id}` },
        delay: 90_000,
      },
    );
    console.log(
      `[submit-embed-batch] ws=${workspaceId} job=${batchJob.id} submitted ${embeddable.length} embedding(s) (provider=${providerJobId}, model=${model})`,
    );
    return { batchJobId: batchJob.id, submitted: embeddable.length };
  } catch (err) {
    console.error(
      `[submit-embed-batch] workspace=${workspaceId} submit failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    await db.aiBatchJob.update({
      where: { id: batchJob.id },
      data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) },
    });
    // Fall the threads back to the SYNCHRONOUS path: this both marks the
    // BatchThreadState FAILED and enqueues classify-thread jobs (with
    // classifyingAt stamped). Reverting to bare PENDING without re-enqueuing
    // would strand them as unrouted "backlog" and re-trigger the Route-now
    // banner.
    await fallbackThreadsToOnline(workspaceId, embeddable.map((t) => t.emailThreadId));
    return null;
  }
}
