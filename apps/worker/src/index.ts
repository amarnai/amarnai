import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { GmailClient, GmailAuthError } from "@amarnai/gmail";
import { createSyncInboxWorker } from "./jobs/sync-inbox.js";
import { createClassifyThreadWorker } from "./jobs/classify-thread.js";
import { createBackfillInboxWorker } from "./jobs/backfill-inbox.js";
import { syncInboxQueue, backfillInboxQueue } from "./queues.js";
import { closePublisher } from "./redis-publisher.js";

// ─── Watch renewal ────────────────────────────────────────────────────────────

/**
 * Renews the gmail.users.watch() subscription for every active Gmail connection.
 * Gmail push watches expire after ~7 days, so this runs once on startup and
 * then daily to keep all workspaces registered.
 *
 * No-ops when GMAIL_PUBSUB_TOPIC is not configured (polling-only deployments).
 */
async function renewAllGmailWatches(): Promise<void> {
  if (!config.gmail.pubsubTopic) return;

  const connections = await db.gmailConnection.findMany({
    where: { status: "ACTIVE" },
    select: { workspaceId: true, gmailAddress: true, encryptedRefreshToken: true },
  });

  if (connections.length === 0) return;

  await Promise.allSettled(
    connections.map(async (conn) => {
      const client = new GmailClient(conn.encryptedRefreshToken);
      try {
        const result = await client.watchInbox(config.gmail.pubsubTopic!);
        const expiresAt = new Date(Number(result.expiration)).toISOString();
        console.log(`[watch-renewal] Renewed watch for ${conn.gmailAddress} — historyId=${result.historyId} expires=${expiresAt}`);
      } catch (err) {
        // Auth errors mean the refresh token is revoked/invalid — log at info
        // level since sync jobs will surface this to the user separately.
        if (err instanceof GmailAuthError) {
          console.log(`[watch-renewal] Skipping ${conn.gmailAddress} — token needs re-authorization`);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[watch-renewal] Failed for ${conn.gmailAddress}:`, msg);
        }
      }
    })
  );
}

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

  // ── Gmail push watch renewal ───────────────────────────────────────────────
  // Renew watch registrations on startup, then daily (Gmail watches expire ~7d).
  await renewAllGmailWatches();

  const watchRenewalHandle = setInterval(() => {
    renewAllGmailWatches().catch((err) => {
      console.error("[watch-renewal] Failed:", err);
    });
  }, 24 * 60 * 60 * 1000);

  if (config.gmail.pubsubTopic) {
    console.log("[worker] Gmail push notifications active — watch renewal scheduled daily");
  }

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
    clearInterval(watchRenewalHandle);

    await Promise.all([
      syncWorker.close(),
      classifyWorker.close(),
      backfillWorker.close(),
    ]);

    await Promise.all([
      syncInboxQueue.close(),
      backfillInboxQueue.close(),
      closePublisher(),
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
