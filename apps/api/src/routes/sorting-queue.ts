import { Hono } from "hono";
import { z } from "zod";
import { Job } from "bullmq";
import { db } from "@amarnai/db";
import { classifyThreadQueue } from "../queues.js";
import { DEFAULT_GMAIL_SYNC_SETTINGS, isTaxonomyRoutable } from "@amarnai/shared";
import { DEDUP_CLASSIFY_UNROUTED, DEDUP_CLASSIFY_UNCLASSIFIED } from "@amarnai/queue";
import { resolveEmailAccountId } from "../services/email-account.js";

/**
 * Whether the workspace taxonomy has enough non-root nodes reachable from the
 * root for routing to produce meaningful results. Orphaned nodes (not linked to
 * the root) are excluded, matching how the router enumerates candidate paths.
 */
async function isWorkspaceTaxonomyRoutable(workspaceId: string): Promise<boolean> {
  const [nodes, edges] = await Promise.all([
    db.taxonomyNode.findMany({
      where: { workspaceId },
      select: { id: true, isRoot: true },
    }),
    db.taxonomyEdge.findMany({
      where: { workspaceId },
      select: { sourceNodeId: true, targetNodeId: true },
    }),
  ]);
  return isTaxonomyRoutable(nodes, edges);
}

const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const threadParam = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const sortingQueue = new Hono();

/**
 * POST /workspaces/:workspaceId/sorting-queue/pause
 *
 * Pauses the sorting queue for this workspace. Background sync and backfill
 * jobs will skip enqueuing classify-thread jobs while paused.
 * Returns 200 with the updated sortingPaused state.
 */
sortingQueue.post("/workspaces/:workspaceId/sorting-queue/pause", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  await db.gmailSyncSettings.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      sortingPaused: true,
      includeSpam: DEFAULT_GMAIL_SYNC_SETTINGS.includeSpam,
      includePromotions: DEFAULT_GMAIL_SYNC_SETTINGS.includePromotions,
    },
    update: { sortingPaused: true },
  });

  return c.json({ sortingPaused: true });
});

/**
 * POST /workspaces/:workspaceId/sorting-queue/resume
 *
 * Resumes the sorting queue for this workspace and re-enqueues all PENDING
 * threads that have no active classify job. Requires a routable taxonomy —
 * if taxonomy is too weak, sorting is still unpaused but no classify jobs are
 * enqueued (the sync cycle's stuck-thread recovery will handle them once the
 * taxonomy is set up). Returns 200 with the updated state and the count of
 * threads re-enqueued.
 */
sortingQueue.post("/workspaces/:workspaceId/sorting-queue/resume", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  const [syncSettings, taxonomyRoutable] = await Promise.all([
    db.gmailSyncSettings.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        sortingPaused: false,
        includeSpam: DEFAULT_GMAIL_SYNC_SETTINGS.includeSpam,
        includePromotions: DEFAULT_GMAIL_SYNC_SETTINGS.includePromotions,
      },
      update: { sortingPaused: false },
      select: { includeSpam: true, includePromotions: true },
    }),
    isWorkspaceTaxonomyRoutable(workspaceId),
  ]);

  // Only re-enqueue when taxonomy is routable. Without a valid taxonomy,
  // classify-thread cannot route threads and they'd loop back to PENDING.
  // The sync cycle's stuck-thread recovery will classify them automatically
  // once taxonomy is set up.
  if (!taxonomyRoutable) {
    return c.json({ sortingPaused: false, requeued: 0 });
  }

  // Re-enqueue all PENDING threads that aren't already being classified.
  const pendingWhere = {
    workspaceId,
    triageStatus: "PENDING" as const,
    classifyingAt: null,
    gmailIsTrash: false,
    ...(!syncSettings.includeSpam    ? { gmailIsSpam: false }       : {}),
    ...(!syncSettings.includePromotions ? { gmailIsPromotions: false } : {}),
  };

  const pending = await db.emailThread.findMany({
    where: pendingWhere,
    select: { id: true },
    orderBy: { latestMessageAt: "desc" },
  });

  if (pending.length > 0) {
    const now = new Date();
    await db.emailThread.updateMany({
      where: { id: { in: pending.map((t) => t.id) } },
      data: { classifyingAt: now },
    });

    await classifyThreadQueue.addBulk(
      pending.map(({ id: emailThreadId }) => ({
        name: "classify-thread",
        data: { workspaceId, emailThreadId, source: "REROUTE" as const },
        opts: {
          deduplication: { id: `classify_resume_${workspaceId}_${emailThreadId}` },
          priority: 5,
        },
      }))
    );
  }

  return c.json({ sortingPaused: false, requeued: pending.length });
});

/**
 * DELETE /workspaces/:workspaceId/email-threads/:threadId/classify
 *
 * Cancels a pending classify-thread job for a specific thread.
 * Clears classifyingAt so the thread no longer shows as queued/classifying.
 * If the job is already active (worker is processing it), it cannot be
 * interrupted mid-run but classifyingAt is still cleared for UI consistency.
 */
sortingQueue.delete(
  "/workspaces/:workspaceId/email-threads/:threadId/classify",
  async (c) => {
    const parsed = threadParam.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsed.success) return c.json({ error: "Invalid params" }, 400);

    const { workspaceId, threadId } = parsed.data;

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true },
    });
    if (!thread) return c.json({ error: "Thread not found" }, 404);

    // Try to remove any waiting job from the classify queue.
    // Jobs may be enqueued with different deduplication key patterns.
    const dedupKeys = [
      `classify_${workspaceId}_${threadId}`,
      `classify_backfill_${workspaceId}_${threadId}`,
      `classify_resume_${workspaceId}_${threadId}`,
      `classify_quota_recovery_${workspaceId}_${threadId}`,
      `${DEDUP_CLASSIFY_UNROUTED}_${workspaceId}_${threadId}`,
      `${DEDUP_CLASSIFY_UNCLASSIFIED}_${workspaceId}_${threadId}`,
    ];

    let removed = false;
    for (const key of dedupKeys) {
      try {
        const jobId = await classifyThreadQueue.getDeduplicationJobId(key);
        if (jobId) {
          const job = await Job.fromId(classifyThreadQueue, jobId);
          if (job) {
            const state = await job.getState();
            if (state === "waiting" || state === "delayed" || state === "prioritized") {
              await job.remove();
              removed = true;
              break;
            }
          }
        }
      } catch {
        // Non-fatal: best-effort removal
      }
    }

    // Always clear classifyingAt so the UI no longer shows the thread as sorting.
    await db.emailThread.update({
      where: { id: threadId },
      data: { classifyingAt: null },
    });

    return c.json({ cancelled: true, jobRemoved: removed });
  }
);

// ── Shared helper ──────────────────────────────────────────────────────────────

async function enqueueThreadsForRouting(
  workspaceId: string,
  statuses: ("PENDING" | "UNROUTED" | "UNCLASSIFIED")[],
  dedupPrefix: string,
  syncSettings: { includeSpam: boolean; includePromotions: boolean } | null,
  applyInboxFilter: boolean
): Promise<number> {
  const where = {
    workspaceId,
    triageStatus: { in: statuses },
    classifyingAt: null,
    ...(applyInboxFilter
      ? {
          gmailIsTrash: false,
          ...(!syncSettings?.includeSpam ? { gmailIsSpam: false } : {}),
          ...(!syncSettings?.includePromotions ? { gmailIsPromotions: false } : {}),
        }
      : {}),
  };

  const threads = await db.emailThread.findMany({ where, select: { id: true } });
  if (threads.length === 0) return 0;

  const enqueuedAt = new Date();
  await db.emailThread.updateMany({
    where: { id: { in: threads.map((t) => t.id) } },
    data: { triageStatus: "PENDING", classifyingAt: enqueuedAt },
  });

  await classifyThreadQueue.addBulk(
    threads.map(({ id: emailThreadId }) => ({
      name: "classify-thread",
      data: { workspaceId, emailThreadId, source: "REROUTE" as const },
      opts: {
        deduplication: { id: `${dedupPrefix}_${workspaceId}_${emailThreadId}` },
        priority: 5,
      },
    }))
  );

  return threads.length;
}

/**
 * POST /workspaces/:workspaceId/sorting-queue/route-unrouted
 *
 * Manually starts routing for all threads waiting to be sorted. The waiting set
 * is every inbox-visible thread still PENDING (synced while the taxonomy was too
 * weak to route) plus any legacy UNROUTED threads. Requires a strong taxonomy
 * (enough non-root nodes reachable from the root). Returns 422 with
 * `{ error: "taxonomy_too_weak" }` if the taxonomy is insufficient.
 *
 * This is the only path that routes the historical backlog — background sync
 * never auto-routes waiting threads, so bulk AI routing only happens on explicit
 * user action.
 */
sortingQueue.post("/workspaces/:workspaceId/sorting-queue/route-unrouted", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  if (!(await isWorkspaceTaxonomyRoutable(workspaceId))) {
    return c.json({ error: "taxonomy_too_weak" }, 422);
  }

  const syncSettings = await db.gmailSyncSettings.findUnique({
    where: { workspaceId },
    select: { includeSpam: true, includePromotions: true },
  });

  const queued = await enqueueThreadsForRouting(
    workspaceId,
    ["PENDING", "UNROUTED"],
    DEDUP_CLASSIFY_UNROUTED,
    syncSettings,
    true
  );

  // If a backfill is still in flight, arm auto-routing so threads that arrive
  // after this click are routed automatically instead of re-prompting the user.
  // Cleared by the worker when the backfill reaches a terminal state.
  await armAutoRouteBacklogIfBackfilling(workspaceId);

  return c.json({ queued });
});

/**
 * When a backfill has not yet finished, set ProviderSyncState.autoRouteBacklogArmed
 * so the sync/backfill backlog gates auto-enqueue newly-arrived PENDING threads.
 * No-op when backfill is already DONE (no race) or no sync state exists yet.
 */
async function armAutoRouteBacklogIfBackfilling(workspaceId: string): Promise<void> {
  const emailAccountId = await resolveEmailAccountId(workspaceId);
  if (!emailAccountId) return;

  // Arm only while backfill is still in progress (PENDING/RUNNING/ERROR-retrying).
  await db.providerSyncState.updateMany({
    where: { emailAccountId, backfillStatus: { not: "DONE" } },
    data: { autoRouteBacklogArmed: true },
  });
}

/**
 * POST /workspaces/:workspaceId/sorting-queue/reroute-unclassified
 *
 * Enqueues all UNCLASSIFIED threads for re-classification. No taxonomy check
 * required — routing already ran once; re-routing after taxonomy changes is
 * always permitted.
 */
sortingQueue.post("/workspaces/:workspaceId/sorting-queue/reroute-unclassified", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  const queued = await enqueueThreadsForRouting(
    workspaceId,
    ["UNCLASSIFIED"],
    DEDUP_CLASSIFY_UNCLASSIFIED,
    null,
    false
  );

  return c.json({ queued });
});

export { sortingQueue as sortingQueueRoute };
