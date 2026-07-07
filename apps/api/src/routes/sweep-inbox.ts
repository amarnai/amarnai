import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { backfillInboxQueue } from "../services/queue-client.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const sweepInbox = new Hono();

/**
 * POST /workspaces/:workspaceId/sweep-inbox
 *
 * Re-evaluates Gmail label flags (spam / promotions / trash) on all threads in
 * the workspace and hides those that no longer pass the current sync-filter
 * settings. Implemented by resetting backfillStatus to PENDING and re-enqueueing
 * the backfill-inbox job, which updates flags on existing threads from lightweight
 * metadata (no extra Gmail API calls per thread) and persists them for query-time
 * filtering.
 *
 * Returns 202 Accepted — the job is queued but not yet processed.
 * Returns 422 if the workspace has no active Gmail connection or no sync state.
 */
sweepInbox.post("/workspaces/:workspaceId/sweep-inbox", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  // Verify an active Gmail connection exists.
  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { status: true, emailAddress: true, subjectId: true },
  });

  if (!connection) return c.json({ error: "No Gmail connection found" }, 422);
  if (connection.status !== "ACTIVE") {
    return c.json({ error: "Gmail connection is not active" }, 422);
  }

  // Resolve the EmailAccount so we can update ProviderSyncState.
  const providerAccountId = connection.subjectId ?? connection.emailAddress;
  const emailAccount = await db.emailAccount.findUnique({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    select: { id: true },
  });

  if (!emailAccount) {
    return c.json({ error: "Email account not found — run a sync first" }, 422);
  }

  // Reset backfillStatus to PENDING and clear the resume cursor so the worker
  // re-scans all threads from the beginning. Bump backfillGeneration so any
  // chunk already in flight detects it was superseded and abandons its progress
  // instead of overwriting this reset.
  await db.providerSyncState.update({
    where: { emailAccountId: emailAccount.id },
    data: {
      backfillStatus: "PENDING",
      backfillStartedAt: null,
      backfillPageToken: null,
      backfillProcessedCount: 0,
      backfillTotalEstimate: 0,
      backfillSkipped: 0,
      backfillGeneration: { increment: 1 },
      // Recompute the plan-cap state from scratch on the fresh scan.
      backfillCapReached: false,
      backfillBeyondCount: 0,
      backfillLimitState: "NONE",
    },
  });

  // Enqueue the job. Deduplication prevents double-enqueueing if one is
  // already waiting in the queue.
  await backfillInboxQueue.add(
    "backfill-inbox",
    { workspaceId },
    { deduplication: { id: `backfill-inbox_${workspaceId}` } }
  );

  return c.json({ ok: true, workspaceId }, 202);
});

export { sweepInbox as sweepInboxRoute };
