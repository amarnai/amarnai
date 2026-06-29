/**
 * Submit a per-workspace LLM escalation batch (BACKFILL_BATCH_MODE). One request
 * per escalating thread/round, keyed workspaceId|emailThreadId|step. Records an
 * AiBatchJob(LLM), moves the threads to LLM_PENDING, submits, and enqueues a
 * batch-poll watcher. On submit failure the threads fall back to the online path.
 */
import { db } from "@amarnai/db";
import { createBatchProvider, getBatchProviderConfig } from "@amarnai/ai";
import { batchPollQueue } from "../queues.js";
import { fallbackThreadsToOnline } from "./batch-routing-helpers.js";
import { buildBatchKey } from "./batch-key.js";

const BATCH_EXPIRY_MS = 26 * 60 * 60 * 1_000;

export type LlmBatchRequest = {
  emailThreadId: string;
  step: string;
  system: string;
  user: string;
};

export async function submitLlmBatch(args: {
  workspaceId: string;
  emailAccountId: string;
  requests: LlmBatchRequest[];
  now: Date;
}): Promise<void> {
  const { workspaceId, emailAccountId, requests, now } = args;
  if (requests.length === 0) return;

  const provider = createBatchProvider(getBatchProviderConfig());
  const threadIds = [...new Set(requests.map((r) => r.emailThreadId))];

  const batchJob = await db.aiBatchJob.create({
    data: {
      workspaceId,
      emailAccountId,
      kind: "LLM",
      status: "SUBMITTED",
      modelName: provider.llmModelName,
      requestCount: requests.length,
      expiresAt: new Date(now.getTime() + BATCH_EXPIRY_MS),
    },
    select: { id: true },
  });

  await db.batchThreadState.updateMany({
    where: { emailThreadId: { in: threadIds } },
    data: { status: "LLM_PENDING", llmBatchId: batchJob.id, round: { increment: 1 } },
  });

  try {
    const { providerJobId } = await provider.submitGenerate(
      requests.map((r) => ({
        key: buildBatchKey(workspaceId, r.emailThreadId, r.step),
        system: r.system,
        user: r.user,
      })),
    );
    await db.aiBatchJob.update({
      where: { id: batchJob.id },
      data: { providerJobId, status: "RUNNING" },
    });
    await batchPollQueue.add(
      "batch-poll",
      { workspaceId, batchJobId: batchJob.id },
      { deduplication: { id: `batch_poll_${workspaceId}_${batchJob.id}` }, delay: 90_000 },
    );
    console.log(
      `[submit-llm-batch] ws=${workspaceId} job=${batchJob.id} submitted ${requests.length} escalation(s) across ${threadIds.length} thread(s) (provider=${providerJobId})`,
    );
  } catch (err) {
    console.error(
      `[submit-llm-batch] workspace=${workspaceId} submit failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    await db.aiBatchJob.update({
      where: { id: batchJob.id },
      data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) },
    });
    await fallbackThreadsToOnline(workspaceId, threadIds);
  }
}
