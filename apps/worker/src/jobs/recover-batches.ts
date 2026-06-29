/**
 * Recover stalled Batch-API polls (BACKFILL_BATCH_MODE).
 *
 * The batch-poll loop is a self-re-enqueuing delayed job. If that job is ever
 * dropped — a worker restart/deploy at the wrong moment, a lost Redis delayed
 * entry — the AiBatchJob is left RUNNING with nothing polling it, so its threads
 * are stuck *_PENDING until the (hours-away) expiry. This sweep finds non-terminal
 * batches whose last poll is stale and re-enqueues a poll for each, making the
 * chain self-healing across restarts. Run on worker startup and on an interval.
 *
 * Only STALLED batches are re-enqueued (polledAt older than the threshold, or
 * never polled), so healthy in-flight batches are not disturbed and polls don't
 * pile up. No dedup is used: a stalled batch has no active poll to duplicate, and
 * batch-poll ingestion is idempotent (a COMPLETED/terminal batch is never
 * re-ingested) so a rare double-poll is harmless.
 */
import { db } from "@amarnai/db";
import { batchPollQueue } from "../queues.js";

/** A batch not polled within this window is treated as stalled. */
const STALE_POLL_MS = 5 * 60 * 1_000;

export async function recoverStalledBatches(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_POLL_MS);
  const stalled = await db.aiBatchJob.findMany({
    where: {
      status: { in: ["SUBMITTED", "RUNNING"] },
      providerJobId: { not: null },
      expiresAt: { gt: new Date() },
      OR: [{ polledAt: null }, { polledAt: { lt: staleBefore } }],
    },
    select: { id: true, workspaceId: true },
  });
  if (stalled.length === 0) return;

  for (const b of stalled) {
    await batchPollQueue.add("batch-poll", { workspaceId: b.workspaceId, batchJobId: b.id });
  }
  console.log(`[batch-recovery] re-enqueued ${stalled.length} stalled batch poll(s)`);
}
