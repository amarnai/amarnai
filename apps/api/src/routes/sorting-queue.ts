import { Hono } from "hono";
import { z } from "zod";
import { Job } from "bullmq";
import { db } from "@amarnai/db";
import { classifyThreadQueue } from "../queues.js";
import { backfillInboxQueue } from "../services/queue-client.js";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";

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
 * threads that have no active classify job. Returns 200 with the updated state
 * and the count of threads re-enqueued.
 */
sortingQueue.post("/workspaces/:workspaceId/sorting-queue/resume", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  const [syncSettings] = await Promise.all([
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
  ]);

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
        data: { workspaceId, emailThreadId },
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

/**
 * POST /workspaces/:workspaceId/sorting-queue/start
 *
 * Manually triggers the historical inbox backfill for a workspace.
 * Requires the workspace to have at least 3 taxonomy nodes; returns 422
 * if the taxonomy is too small. Returns 202 Accepted once the job is queued.
 */
sortingQueue.post("/workspaces/:workspaceId/sorting-queue/start", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  const nodeCount = await db.taxonomyNode.count({ where: { workspaceId } });
  if (nodeCount <= 3) {
    return c.json(
      { error: "More than 3 taxonomy nodes are required before sorting can start" },
      422
    );
  }

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { status: true },
  });
  if (!connection) return c.json({ error: "No Gmail connection found" }, 422);
  if (connection.status !== "ACTIVE") {
    return c.json({ error: "Gmail connection is not active" }, 422);
  }

  await backfillInboxQueue.add(
    "backfill-inbox",
    { workspaceId },
    { deduplication: { id: `backfill-inbox_${workspaceId}` } }
  );

  return c.json({ ok: true, workspaceId }, 202);
});

export { sortingQueue as sortingQueueRoute };
