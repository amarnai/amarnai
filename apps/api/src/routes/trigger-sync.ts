import { Hono } from "hono";
import { z } from "zod";
import { db } from "@aziru/db";
import { syncInboxQueue } from "../services/queue-client.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const triggerSync = new Hono();

/**
 * POST /workspaces/:workspaceId/trigger-sync
 *
 * Enqueues an immediate sync-inbox job for the workspace.
 * Used by the Gmail OAuth callback so the inbox is synced right away
 * rather than waiting for the next scheduler polling cycle.
 *
 * Returns 202 Accepted — the job is queued but not yet processed.
 * Returns 422 if the workspace has no active Gmail connection.
 */
triggerSync.post("/workspaces/:workspaceId/trigger-sync", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { status: true },
  });

  if (!connection) return c.json({ error: "No Gmail connection found" }, 422);
  if (connection.status !== "ACTIVE") {
    return c.json({ error: "Gmail connection is not active" }, 422);
  }

  await syncInboxQueue.add(
    "sync-inbox",
    { workspaceId },
    {
      // Same deduplication key as the webhook so a manual trigger and a
      // concurrent push notification don't both queue the same workspace.
      deduplication: { id: `sync-inbox_${workspaceId}` },
    }
  );

  return c.json({ ok: true, workspaceId }, 202);
});

export { triggerSync as triggerSyncRoute };
