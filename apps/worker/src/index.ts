import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { createSyncInboxWorker } from "./jobs/sync-inbox.js";
import { createClassifyThreadWorker } from "./jobs/classify-thread.js";
import { createBackfillInboxWorker } from "./jobs/backfill-inbox.js";
import { syncInboxQueue, backfillInboxQueue } from "./queues.js";

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Enqueues one `sync-inbox` job per workspace that has an active Gmail
 * connection. Jobs are deduplicated by jobId so concurrent ticks cannot stack
 * up duplicate syncs for the same workspace.
 */
async function scheduleSyncJobs(): Promise<void> {
  const connections = await db.gmailConnection.findMany({
    where: { status: "ACTIVE" },
    select: { workspaceId: true },
  });

  if (connections.length === 0) return;

  await syncInboxQueue.addBulk(
    connections.map(({ workspaceId }) => ({
      name: "sync-inbox",
      data: { workspaceId },
      opts: {
        // Deduplicate while a sync is already waiting or active for this
        // workspace. Unlike `jobId`, BullMQ's `deduplication` option does NOT
        // block re-adds once the job has completed — avoiding the bug where a
        // fixed jobId persisted in the completed set and caused every subsequent
        // scheduler tick to be silently dropped.
        deduplication: {
          id: `sync-inbox_${workspaceId}`,
        },
      },
    }))
  );

  console.log(`[scheduler] Enqueued sync for ${connections.length} workspace(s)`);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[worker] Starting…");

  // Register job processors.
  const syncWorker = createSyncInboxWorker();
  const classifyWorker = createClassifyThreadWorker();
  const backfillWorker = createBackfillInboxWorker();

  console.log("[worker] sync-inbox, classify-thread, and backfill-inbox workers registered");

  // Run immediately on startup so the first sync doesn't wait a full interval.
  await scheduleSyncJobs();

  // Then repeat on the configured interval.
  const intervalHandle = setInterval(() => {
    scheduleSyncJobs().catch((err) => {
      console.error("[scheduler] Failed to enqueue sync jobs:", err);
    });
  }, config.worker.inboxSyncIntervalMs);

  console.log(
    `[worker] Scheduler running — polling every ${config.worker.inboxSyncIntervalMs / 1000}s`
  );

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  //
  // On SIGTERM / SIGINT:
  //  1. Stop the scheduler so no new jobs are enqueued.
  //  2. Close both workers (waits for in-flight jobs to finish, up to 30 s).
  //  3. Close queue connections.
  //  4. Disconnect Prisma.

  async function shutdown(signal: string): Promise<void> {
    console.log(`[worker] ${signal} received — shutting down gracefully…`);

    clearInterval(intervalHandle);

    await Promise.all([
      syncWorker.close(),
      classifyWorker.close(),
      backfillWorker.close(),
    ]);

    await Promise.all([
      syncInboxQueue.close(),
      backfillInboxQueue.close(),
    ]);

    await db.$disconnect();

    console.log("[worker] Shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] Fatal startup error:", err);
  process.exit(1);
});
