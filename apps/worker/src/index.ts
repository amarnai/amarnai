import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { GmailClient, GmailAuthError } from "@amarnai/gmail";
import { deleteExpiredRefreshTokens } from "@amarnai/auth";
import { processPendingSubscriptionCancellations } from "@amarnai/billing";
import {
  createEmbeddingProvider,
  getEmbeddingProviderConfig,
  EmbeddingModelNotFoundError,
  createAIProvider,
  getRoutingAIProviderConfig,
  LLMAuthenticationError,
} from "@amarnai/ai";
import { createSyncInboxWorker } from "./jobs/sync-inbox.js";
import { createClassifyThreadWorker } from "./jobs/classify-thread.js";
import { createBackfillInboxWorker } from "./jobs/backfill-inbox.js";
import { createLifecycleEmailWorker } from "./jobs/lifecycle-email.js";
import { createGenerateTaxonomyWorker } from "./jobs/generate-taxonomy.js";
import { createPushNotificationWorker } from "./jobs/push-notification.js";
import { syncInboxQueue, backfillInboxQueue, lifecycleEmailQueue, generateTaxonomyQueue, pushNotificationQueue } from "./queues.js";
import { closePublisher } from "./redis-publisher.js";
import { closeAiDedup } from "./ai-dedup.js";
import { closePushBudget } from "./notifications/notify-threads.js";
import { closeAssignPushBudget } from "./notifications/notify-thread-assigned.js";

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

// ─── Lifecycle reminder emails ─────────────────────────────────────────────────

const LIFECYCLE_EMAIL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Enqueues one `lifecycle-email` job per user who is due a weekly reminder.
 *
 * Runs on a DAILY tick rather than a 7-day timer: a raw weekly setInterval would
 * reset on every worker restart/redeploy and so rarely fire. Instead this tick
 * selects users whose last send (`lifecycleEmailSentAt`) is null or older than 7
 * days, which makes the effective cadence weekly, restart-safe, idempotent, and
 * naturally staggered across the week. Only verified, opted-in users who belong
 * to a workspace with an active Gmail connection are considered — dormant or
 * disconnected accounts are never emailed. Per-user dedup prevents a duplicate
 * job while one is already queued for the same user.
 */
async function scheduleLifecycleEmails(): Promise<void> {
  const dueBefore = new Date(Date.now() - LIFECYCLE_EMAIL_INTERVAL_MS);
  const users = await db.user.findMany({
    where: {
      emailVerified: { not: null },
      lifecycleEmailsEnabled: true,
      OR: [{ lifecycleEmailSentAt: null }, { lifecycleEmailSentAt: { lte: dueBefore } }],
      workspaceMemberships: { some: { workspace: { gmailConnection: { status: "ACTIVE" } } } },
    },
    select: { id: true },
  });

  if (users.length === 0) return;

  await lifecycleEmailQueue.addBulk(
    users.map(({ id }) => ({
      name: "lifecycle-email",
      data: { userId: id },
      opts: {
        // Same pattern as sync-inbox: dedup only while a job is waiting/active for
        // this user, so a daily tick cannot stack duplicate reminders.
        deduplication: { id: `lifecycle-email_${id}` },
      },
    })),
  );

  console.log(`[lifecycle-email] Enqueued reminders for ${users.length} due user(s)`);
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

/**
 * Verifies the LLM credentials work before processing any jobs.
 *
 * An invalid API key returns 401 from the LLM API and breaks the routing step
 * of every classify-thread job identically. Catching it once at startup turns
 * thousands of failed jobs (and a log-rate-limit storm) into a single clear
 * fatal error. Ollama (no auth) and mock providers are skipped; non-auth errors
 * are non-fatal since the LLM is only invoked for ambiguous threads.
 */
async function preflightLLM(): Promise<void> {
  const aiConfig = getRoutingAIProviderConfig();
  if (aiConfig.provider !== "frontier") return;

  const provider = createAIProvider(aiConfig);
  try {
    await provider.chat([{ role: "user", content: 'Reply with the JSON {"ok":true}.' }]);
    console.log(
      `[worker] LLM preflight OK — provider=${provider.providerName} model=${provider.modelName}`,
    );
  } catch (err) {
    if (err instanceof LLMAuthenticationError) {
      console.error(
        `[worker] Fatal: ${err.message}. Set FRONTIER_LLM_API_KEY (and FRONTIER_LLM_BASE_URL for Gemini) to valid credentials and redeploy.`,
      );
      process.exit(1);
    }
    // Other errors (transient network, rate limits, response formatting)
    // shouldn't block startup — per-job retries handle those. Log and continue.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] LLM preflight check failed (non-fatal): ${msg}`);
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[worker] Starting…");

  // Verify the embedding model and LLM credentials before accepting any jobs.
  await preflightEmbeddingModel();
  await preflightLLM();

  // Register job processors.
  const syncWorker = createSyncInboxWorker();
  const classifyWorker = createClassifyThreadWorker();
  const backfillWorker = createBackfillInboxWorker();
  const lifecycleEmailWorker = createLifecycleEmailWorker();
  const generateTaxonomyWorker = createGenerateTaxonomyWorker();
  const pushNotificationWorker = createPushNotificationWorker();

  console.log("[worker] sync-inbox, classify-thread, backfill-inbox, lifecycle-email, generate-taxonomy, and push-notification workers registered");

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

  // ── Expired refresh-token cleanup ──────────────────────────────────────────
  // Delete refresh tokens past their expiry on startup, then daily, so consumed
  // and expired rows do not accumulate.
  async function reapRefreshTokens(): Promise<void> {
    const count = await deleteExpiredRefreshTokens();
    if (count > 0) console.log(`[refresh-token-reaper] Deleted ${count} expired refresh token(s)`);
  }

  await reapRefreshTokens().catch((err) =>
    console.error("[refresh-token-reaper] Failed:", err)
  );

  const refreshReaperHandle = setInterval(() => {
    reapRefreshTokens().catch((err) => console.error("[refresh-token-reaper] Failed:", err));
  }, 24 * 60 * 60 * 1000);

  // ── Pending subscription cancellations ─────────────────────────────────────
  // When an account is deleted and Stripe is unreachable, the cancellation is
  // recorded as a durable row so nobody keeps paying for a deleted account. This
  // tick reconciles those rows against Stripe (retrieve-then-cancel) until each
  // subscription can no longer bill. Fully autonomous; no-ops without Stripe.
  async function retryPendingSubscriptionCancellations(): Promise<void> {
    const resolved = await processPendingSubscriptionCancellations();
    if (resolved > 0) {
      console.log(`[billing-cancellation] Resolved ${resolved} pending cancellation(s)`);
    }
  }

  await retryPendingSubscriptionCancellations().catch((err) =>
    console.error("[billing-cancellation] Failed:", err),
  );

  const pendingCancellationHandle = setInterval(() => {
    retryPendingSubscriptionCancellations().catch((err) =>
      console.error("[billing-cancellation] Failed:", err),
    );
  }, 15 * 60 * 1000);

  // ── Weekly lifecycle reminder emails ───────────────────────────────────────
  // Enqueue due reminders on startup, then on a daily tick. The 7-day cadence is
  // enforced per user via lifecycleEmailSentAt (see scheduleLifecycleEmails), so
  // a daily tick gives a restart-safe weekly send rather than a fragile 7-day
  // timer that resets on every redeploy.
  await scheduleLifecycleEmails().catch((err) =>
    console.error("[lifecycle-email] Failed to enqueue reminders:", err)
  );

  const lifecycleEmailHandle = setInterval(() => {
    scheduleLifecycleEmails().catch((err) =>
      console.error("[lifecycle-email] Failed to enqueue reminders:", err)
    );
  }, 24 * 60 * 60 * 1000);

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
    clearInterval(refreshReaperHandle);
    clearInterval(pendingCancellationHandle);
    clearInterval(lifecycleEmailHandle);

    await Promise.all([
      syncWorker.close(),
      classifyWorker.close(),
      backfillWorker.close(),
      lifecycleEmailWorker.close(),
      generateTaxonomyWorker.close(),
      pushNotificationWorker.close(),
    ]);

    await Promise.all([
      syncInboxQueue.close(),
      backfillInboxQueue.close(),
      lifecycleEmailQueue.close(),
      generateTaxonomyQueue.close(),
      pushNotificationQueue.close(),
      closePublisher(),
      closeAiDedup(),
      closePushBudget(),
      closeAssignPushBudget(),
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
