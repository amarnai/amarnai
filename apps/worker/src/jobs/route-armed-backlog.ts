import { db } from "@aziru/db";
import { DEDUP_CLASSIFY_UNROUTED } from "@aziru/queue";
import { classifyThreadQueue } from "../queues.js";

/**
 * Enqueue the never-attempted PENDING backlog for routing — the invalid-taxonomy
 * bulk backlog: threads that are PENDING, never classified (classifyFailedAt
 * null), and not already queued (classifyingAt null).
 *
 * Called only while ProviderSyncState.autoRouteBacklogArmed is set — i.e. the user
 * started backfill routing while a backfill was still in flight, opting the
 * arriving historical backlog into automatic routing until the backfill completes.
 * This closes the race where a backfill chunk leaves threads PENDING around the
 * same time as the start, which would otherwise re-surface the start banner.
 *
 * Tagged BACKFILL — arming only happens during an active (initial) backfill, so
 * this sweep is part of the one-time historical allowance, exempt from the monthly
 * thread-sort quota, matching the manual start path. Dedup-keyed identically to
 * the manual start path (DEDUP_CLASSIFY_UNROUTED) so a thread already queued by
 * that path is never double-enqueued. The caller gates on a strong taxonomy and
 * sorting not being paused — the conditions under which routing can actually
 * succeed.
 *
 * Returns the number of threads enqueued.
 */
export async function enqueueArmedBacklog(workspaceId: string): Promise<number> {
  const backlog = await db.emailThread.findMany({
    where: {
      workspaceId,
      triageStatus: "PENDING",
      classifyFailedAt: null,
      classifyingAt: null,
      gmailIsTrash: false,
    },
    select: { id: true },
    orderBy: { latestMessageAt: "desc" },
  });
  if (backlog.length === 0) return 0;

  const enqueuedAt = new Date();
  await db.emailThread.updateMany({
    where: { id: { in: backlog.map((t) => t.id) } },
    data: { classifyingAt: enqueuedAt },
  });

  await classifyThreadQueue.addBulk(
    backlog.map(({ id: emailThreadId }) => ({
      name: "classify-thread",
      data: { workspaceId, emailThreadId, source: "BACKFILL" as const },
      opts: {
        deduplication: { id: `${DEDUP_CLASSIFY_UNROUTED}_${workspaceId}_${emailThreadId}` },
        priority: 5,
      },
    })),
  );

  return backlog.length;
}
