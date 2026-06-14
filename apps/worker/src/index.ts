import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { GmailClient, GmailAuthError } from "@amarnai/gmail";
import {
  createEmbeddingProvider,
  getEmbeddingProviderConfig,
  EmbeddingModelNotFoundError,
} from "@amarnai/ai";
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

  // Only renew watches expiring within 25 hours (or never registered).
  // Watches last ~7 days, so this fires at most once per day per user and
  // avoids rate-limit spikes from frequent worker restarts or redeploys.
  const renewBefore = new Date(Date.now() + 25 * 60 * 60 * 1000);
  const connections = await db.gmailConnection.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { gmailWatchExpiresAt: null },
        { gmailWatchExpiresAt: { lte: renewBefore } },
      ],
    },
    select: { workspaceId: true, gmailAddress: true, encryptedRefreshToken: true },
  });

  if (connections.length === 0) return;

  // Group connections by gmailAddress. Gmail only allows one active watch per
  // mailbox per app, so we register it once per unique address using the first
  // connection in each group, then stamp gmailWatchExpiresAt on all rows.
  const byAddress = new Map<string, typeof connections>();
  for (const conn of connections) {
    const group = byAddress.get(conn.gmailAddress) ?? [];
    group.push(conn);
    byAddress.set(conn.gmailAddress, group);
  }

  await Promise.allSettled(
    Array.from(byAddress.values()).map(async (group) => {
      const primary = group[0]!;
      const client = new GmailClient(primary.encryptedRefreshToken);
      try {
        const result = await client.watchInbox(config.gmail.pubsubTopic!);
        const expiresAt = new Date(Number(result.expiration));
        await Promise.all(
          group.map((conn) =>
            db.gmailConnection.update({
              where: { workspaceId: conn.workspaceId },
              data: { gmailWatchExpiresAt: expiresAt },
            })
          )
        );
        console.log(`[watch-renewal] Renewed watch for ${primary.gmailAddress} (${group.length} workspace(s)) — historyId=${result.historyId} expires=${expiresAt.toISOString()}`);
      } catch (err) {
        // Auth errors mean the refresh token is revoked/invalid — log at info
        // level since sync jobs will surface this to the user separately.
        if (err instanceof GmailAuthError) {
          console.log(`[watch-renewal] Skipping ${primary.gmailAddress} — token needs re-authorization`);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[watch-renewal] Failed for ${primary.gmailAddress}:`, msg);
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

// ─── Preflight ──────────────────────────────────────────────────────────────

/**
 * Verifies the configured embedding model exists before processing any jobs.
 *
 * A missing/retired model returns 404 from the embedding API and breaks every
 * `classify-thread` job identically. Catching it once at startup turns
 * thousands of failed jobs (and a log-rate-limit storm) into a single clear
 * fatal error. Mock providers (used in tests/dev) are skipped.
 */
async function preflightEmbeddingModel(): Promise<void> {
  const embeddingConfig = getEmbeddingProviderConfig();
  if (embeddingConfig.provider === "mock") return;

  const provider = createEmbeddingProvider(embeddingConfig);
  try {
    await provider.embed(["preflight"]);
    console.log(
      `[worker] Embedding preflight OK — provider=${provider.providerName} model=${provider.modelName}`,
    );
  } catch (err) {
    if (err instanceof EmbeddingModelNotFoundError) {
      console.error(
        `[worker] Fatal: ${err.message}. Set FRONTIER_EMBEDDING_MODEL (or OLLAMA_EMBEDDING_MODEL) to a valid model and redeploy.`,
      );
      process.exit(1);
    }
    // Other errors (transient network, rate limits) shouldn't block startup —
    // per-job retries handle those. Log and continue.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Embedding preflight check failed (non-fatal): ${msg}`);
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[worker] Starting…");

  // Verify the embedding model exists before accepting any classify jobs.
  await preflightEmbeddingModel();

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
