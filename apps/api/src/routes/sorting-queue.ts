import { Hono } from "hono";
import { z } from "zod";
import { Job } from "bullmq";
import { db } from "@amarnai/db";
import { classifyThreadQueue } from "../queues.js";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";
import {
  DEDUP_CLASSIFY_UNROUTED,
  DEDUP_CLASSIFY_UNCLASSIFIED,
  DEDUP_CLASSIFY_NEEDS_REVIEW,
  DEDUP_CLASSIFY_MIGRATION,
} from "@amarnai/queue";
import { resolveEmailAccountId } from "../services/email-account.js";
import { isWorkspaceTaxonomyRoutable } from "../services/taxonomy-routable.js";

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
      `${DEDUP_CLASSIFY_NEEDS_REVIEW}_${workspaceId}_${threadId}`,
      `${DEDUP_CLASSIFY_MIGRATION}_${workspaceId}_${threadId}`,
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
  statuses: ("PENDING" | "UNROUTED" | "UNCLASSIFIED" | "NEEDS_REVIEW")[],
  dedupPrefix: string,
  syncSettings: { includeSpam: boolean; includePromotions: boolean } | null,
  applyInboxFilter: boolean,
  source: "BACKFILL" | "REROUTE",
  // When provided, restrict to these thread IDs (pre-filtered by the caller,
  // e.g. eligibility computed from latest-classification state). The status
  // filter still applies, so a thread that left `statuses` between the caller's
  // read and this enqueue is safely skipped.
  threadIds?: string[]
): Promise<number> {
  const where = {
    workspaceId,
    triageStatus: { in: statuses },
    classifyingAt: null,
    ...(threadIds ? { id: { in: threadIds } } : {}),
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
      data: { workspaceId, emailThreadId, source },
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
 * Starts backfill routing: routes all threads waiting to be sorted. The waiting
 * set is every inbox-visible thread still PENDING (imported while routing had not
 * started, or synced while the taxonomy was too weak) plus any legacy UNROUTED
 * threads. Requires a strong taxonomy (enough non-root nodes reachable from the
 * root). Returns 422 with `{ error: "taxonomy_too_weak" }` if the taxonomy is
 * insufficient.
 *
 * This is the only path that routes the historical backlog — neither the import
 * nor background sync auto-routes waiting threads, so bulk AI routing only happens
 * on explicit user action. The first start records the live/backfill boundary
 * (backfillRoutingStartedAt) and routes the waiting set as BACKFILL (the one-time
 * quota-exempt allowance). Later calls — re-routing after taxonomy edits — route
 * as REROUTE, which counts against the monthly quota.
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

  // First start of backfill routing? Stamp the boundary and route the waiting set
  // as the quota-exempt BACKFILL allowance. Once started, re-routes cost quota.
  const firstStart = await markBackfillRoutingStarted(workspaceId);

  const queued = await enqueueThreadsForRouting(
    workspaceId,
    ["PENDING", "UNROUTED"],
    DEDUP_CLASSIFY_UNROUTED,
    syncSettings,
    true,
    firstStart ? "BACKFILL" : "REROUTE"
  );

  // If a backfill is still in flight, arm auto-routing so threads that arrive
  // after this click are routed automatically instead of re-prompting the user.
  // Cleared by the worker when the backfill reaches a terminal state.
  await armAutoRouteBacklogIfBackfilling(workspaceId);

  return c.json({ queued });
});

/**
 * Record the live/backfill boundary the first time the user starts backfill
 * routing. Returns true if this call set it (a first start), false if it was
 * already set. No-op-safe when no sync state exists yet (returns false).
 */
async function markBackfillRoutingStarted(workspaceId: string): Promise<boolean> {
  const emailAccountId = await resolveEmailAccountId(workspaceId);
  if (!emailAccountId) return false;

  // Conditional update: only the first start (still null) writes the timestamp,
  // so the BACKFILL allowance is claimed exactly once even under concurrent calls.
  const { count } = await db.providerSyncState.updateMany({
    where: { emailAccountId, backfillRoutingStartedAt: null },
    data: { backfillRoutingStartedAt: new Date() },
  });
  return count > 0;
}

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
    false,
    "REROUTE"
  );

  return c.json({ queued });
});

/**
 * Which NEEDS_REVIEW threads can a re-sort plausibly place differently. A thread
 * qualifies when EITHER the taxonomy changed since it was last sorted (it may
 * route to a folder that did not exist then) OR its last sort hit a transient
 * infrastructure failure (LLM fail-open / embedding error — retrying may
 * succeed). Threads with no textual content are always excluded: re-sorting them
 * fails identically, so they stay in the review queue for a human.
 *
 * Eligibility is computed from each thread's latest classification, so it is
 * done in JS over the (small) NEEDS_REVIEW set rather than in SQL — matching the
 * latest-classification pattern used elsewhere (email-threads, triage). Threads
 * already classifying are skipped so a re-sort cannot double-enqueue them.
 */
async function findEligibleNeedsReviewThreadIds(workspaceId: string): Promise<string[]> {
  const [workspace, threads] = await Promise.all([
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { taxonomyChangedAt: true },
    }),
    db.emailThread.findMany({
      where: { workspaceId, triageStatus: "NEEDS_REVIEW", classifyingAt: null },
      select: {
        id: true,
        classifications: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, transientFailure: true, decisionSource: true },
        },
      },
    }),
  ]);

  const taxonomyChangedAt = workspace?.taxonomyChangedAt ?? null;

  return threads
    .filter((t) => {
      const latest = t.classifications[0];
      // No classification at all — routing never produced a result; let it try.
      if (!latest) return true;
      // Empty-text threads can never be placed by re-sorting; keep for a human.
      if (latest.decisionSource === "no_text_content") return false;
      // Transient failure (LLM fail-open / embedding error) — retrying may work.
      if (latest.transientFailure) return true;
      // Taxonomy changed since this thread was sorted — it may route differently.
      // NOTE: rows written before this feature shipped have transientFailure=false
      // by default, so a pre-migration fail-open is only re-sortable via this clause.
      return taxonomyChangedAt != null && latest.createdAt < taxonomyChangedAt;
    })
    .map((t) => t.id);
}

/**
 * GET /workspaces/:workspaceId/sorting-queue/reroute-needs-review
 *
 * Returns how many NEEDS_REVIEW threads are eligible for a one-click re-sort.
 * Kept off the hot email-threads counts query because it needs the
 * latest-classification join.
 */
sortingQueue.get("/workspaces/:workspaceId/sorting-queue/reroute-needs-review", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const eligible = (await findEligibleNeedsReviewThreadIds(parsed.data.workspaceId)).length;
  return c.json({ eligible });
});

/**
 * POST /workspaces/:workspaceId/sorting-queue/reroute-needs-review
 *
 * Re-sorts the eligible NEEDS_REVIEW threads (see findEligibleNeedsReviewThreadIds)
 * through the normal routing pipeline as REROUTE. No taxonomy check — routing
 * already ran once for these threads; re-routing is always permitted. Metered
 * like any REROUTE sort (threads already counted this window re-sort free; the
 * overflow defers to QUOTA_BLOCKED as usual).
 */
sortingQueue.post("/workspaces/:workspaceId/sorting-queue/reroute-needs-review", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  const eligibleIds = await findEligibleNeedsReviewThreadIds(workspaceId);
  if (eligibleIds.length === 0) return c.json({ queued: 0 });

  const queued = await enqueueThreadsForRouting(
    workspaceId,
    ["NEEDS_REVIEW"],
    DEDUP_CLASSIFY_NEEDS_REVIEW,
    null,
    false,
    "REROUTE",
    eligibleIds
  );

  return c.json({ queued });
});

export { sortingQueue as sortingQueueRoute };
