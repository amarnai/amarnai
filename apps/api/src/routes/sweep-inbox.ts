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

  // Backfill is restricted to paying plans.
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);
  if (workspace.plan === "FREE") {
    return c.json({ error: "Backfill requires a paying plan" }, 403);
  }

  // Verify an active Gmail connection exists.
  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { status: true, gmailAddress: true, googleSubjectId: true },
  });

  if (!connection) return c.json({ error: "No Gmail connection found" }, 422);
  if (connection.status !== "ACTIVE") {
    return c.json({ error: "Gmail connection is not active" }, 422);
  }

  // Resolve the EmailAccount so we can update ProviderSyncState.
  const providerAccountId = connection.googleSubjectId ?? connection.gmailAddress;
  const emailAccount = await db.emailAccount.findUnique({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    select: { id: true },
  });

  if (!emailAccount) {
    return c.json({ error: "Email account not found — run a sync first" }, 422);
  }

  // Reset backfillStatus to PENDING so the worker re-scans all threads.
  await db.providerSyncState.update({
    where: { emailAccountId: emailAccount.id },
    data: { backfillStatus: "PENDING" },
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
