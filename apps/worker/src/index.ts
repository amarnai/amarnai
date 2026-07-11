import { db, pruneIdempotencyMarkers } from "@amarnai/db";
import { config } from "@amarnai/config";
import { createMailProvider, MailAuthError } from "@amarnai/mail";
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
import { createCaptureReferenceWorker } from "./jobs/capture-reference.js";
import { syncInboxQueue, backfillInboxQueue, lifecycleEmailQueue, generateTaxonomyQueue, pushNotificationQueue, captureReferenceQueue } from "./queues.js";
import { closePublisher } from "./redis-publisher.js";
import { closeAiDedup } from "./ai-dedup.js";
import { closePushBudget } from "./notifications/notify-threads.js";
import { closeAssignPushBudget } from "./notifications/notify-thread-assigned.js";
import { closeGmailDisconnectedPushBudget } from "./notifications/notify-gmail-disconnected.js";

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
  const connections = await db.emailConnection.findMany({
    where: {
      // Gmail push watches only — Outlook subscriptions renew on their own tick
      // (Phase C). Scoping here keeps createMailProvider off the Outlook path.
      provider: "GMAIL",
      status: "ACTIVE",
      OR: [
        { watchExpiresAt: null },
        { watchExpiresAt: { lte: renewBefore } },
      ],
    },
    select: { workspaceId: true, provider: true, emailAddress: true, encryptedRefreshToken: true },
  });

  if (connections.length === 0) return;

  // Group connections by gmailAddress. Gmail only allows one active watch per
  // mailbox per app, so we register it once per unique address using the first
  // connection in each group, then stamp gmailWatchExpiresAt on all rows.
  const byAddress = new Map<string, typeof connections>();
  for (const conn of connections) {
    const group = byAddress.get(conn.emailAddress) ?? [];
    group.push(conn);
    byAddress.set(conn.emailAddress, group);
  }

  await Promise.allSettled(
    Array.from(byAddress.values()).map(async (group) => {
      const primary = group[0]!;
      const client = createMailProvider(primary);
      try {
        const result = await client.registerWatch(config.gmail.pubsubTopic!);
        const expiresAt = new Date(Number(result.expiresAt));
        await Promise.all(
          group.map((conn) =>
            db.emailConnection.update({
              where: { workspaceId: conn.workspaceId },
              data: { watchExpiresAt: expiresAt },
            })
          )
        );
        console.log(`[watch-renewal] Renewed watch for ${primary.emailAddress} (${group.length} workspace(s)) — cursor=${result.cursor} expires=${expiresAt.toISOString()}`);
      } catch (err) {
        // Auth errors mean the refresh token is revoked/invalid — log at info
        // level since sync jobs will surface this to the user separately.
        if (err instanceof MailAuthError) {
          console.log(`[watch-renewal] Skipping ${primary.emailAddress} — token needs re-authorization`);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[watch-renewal] Failed for ${primary.emailAddress}:`, msg);
        }
      }
    })
  );
}

/**
 * Renews the Microsoft Graph change-notification subscription for every active
 * Outlook connection. Graph subscriptions carry a hard ~70h max lifetime with no
 * auto-renew, so this runs on startup and then on the shared daily tick with a
 * wide renewal window to stay comfortably ahead of expiry.
 *
 * No-ops when MS_GRAPH_NOTIFICATION_URL is not configured (polling-only). Each
 * renewal creates a fresh subscription (Graph has no idempotent re-register and
 * we do not persist the subscription id), tearing down existing ones first via
 * stopWatch so exactly one subscription per mailbox survives.
 */
async function renewAllOutlookSubscriptions(): Promise<void> {
  if (!config.outlook.notificationUrl) return;

  // Renew subscriptions expiring within 30 hours (or never registered). With a
  // ~70h lifetime and a daily tick, this always renews well before expiry.
  const renewBefore = new Date(Date.now() + 30 * 60 * 60 * 1000);
  const connections = await db.emailConnection.findMany({
    where: {
      provider: "OUTLOOK",
      status: "ACTIVE",
      OR: [
        { watchExpiresAt: null },
        { watchExpiresAt: { lte: renewBefore } },
      ],
    },
    select: { workspaceId: true, provider: true, emailAddress: true, encryptedRefreshToken: true },
  });

  if (connections.length === 0) return;

  await Promise.allSettled(
    connections.map(async (conn) => {
      const client = createMailProvider(conn);
      try {
        // Tear down existing subscriptions before creating a fresh one so they
        // do not accumulate (POST /subscriptions is not idempotent).
        await client.stopWatch().catch(() => {});
        const result = await client.registerWatch(config.outlook.notificationUrl!);
        const expiresAt = new Date(Number(result.expiresAt));
        await db.emailConnection.update({
          where: { workspaceId: conn.workspaceId },
          data: { watchExpiresAt: expiresAt },
        });
        console.log(`[subscription-renewal] Renewed Graph subscription for ${conn.emailAddress} — cursor=${result.cursor} expires=${expiresAt.toISOString()}`);
      } catch (err) {
        if (err instanceof MailAuthError) {
          console.log(`[subscription-renewal] Skipping ${conn.emailAddress} — token needs re-authorization`);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[subscription-renewal] Failed for ${conn.emailAddress}:`, msg);
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
  const connections = await db.emailConnection.findMany({
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
      workspaceMemberships: { some: { workspace: { emailConnection: { status: "ACTIVE" } } } },
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
  const captureReferenceWorker = createCaptureReferenceWorker();

  console.log("[worker] sync-inbox, classify-thread, backfill-inbox, lifecycle-email, generate-taxonomy, push-notification, and capture-reference workers registered");

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

  // ── Push watch / subscription renewal ──────────────────────────────────────
  // Renew Gmail watches (~7d) and Outlook Graph subscriptions (~70h) on startup,
  // then daily. Both use a renewal window wide enough for a daily cadence.
  await renewAllGmailWatches();
  await renewAllOutlookSubscriptions();

  const watchRenewalHandle = setInterval(() => {
    renewAllGmailWatches().catch((err) => {
      console.error("[watch-renewal] Failed:", err);
    });
    renewAllOutlookSubscriptions().catch((err) => {
      console.error("[subscription-renewal] Failed:", err);
    });
  }, 24 * 60 * 60 * 1000);

  if (config.gmail.pubsubTopic) {
    console.log("[worker] Gmail push notifications active — watch renewal scheduled daily");
  }
  if (config.outlook.notificationUrl) {
    console.log("[worker] Outlook push notifications active — subscription renewal scheduled daily");
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

  // ── Idempotency-marker cleanup ─────────────────────────────────────────────
  // The idempotency ledger gets one row per metered unit of work and is never
  // pruned inline (a marker must outlive its job's retry window). Sweep rows past
  // the retention window on startup, then daily, so the table stays bounded. Only
  // rows far older than any window a duplicate could still fire in are removed, so
  // this can never reintroduce a double-count.
  async function reapIdempotencyMarkers(): Promise<void> {
    const count = await pruneIdempotencyMarkers();
    if (count > 0) console.log(`[idempotency-reaper] Deleted ${count} expired idempotency marker(s)`);
  }

  await reapIdempotencyMarkers().catch((err) =>
    console.error("[idempotency-reaper] Failed:", err)
  );

  const idempotencyReaperHandle = setInterval(() => {
    reapIdempotencyMarkers().catch((err) => console.error("[idempotency-reaper] Failed:", err));
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
    clearInterval(idempotencyReaperHandle);
    clearInterval(pendingCancellationHandle);
    clearInterval(lifecycleEmailHandle);

    await Promise.all([
      syncWorker.close(),
      classifyWorker.close(),
      backfillWorker.close(),
      lifecycleEmailWorker.close(),
      generateTaxonomyWorker.close(),
      pushNotificationWorker.close(),
      captureReferenceWorker.close(),
    ]);

    await Promise.all([
      syncInboxQueue.close(),
      backfillInboxQueue.close(),
      lifecycleEmailQueue.close(),
      generateTaxonomyQueue.close(),
      pushNotificationQueue.close(),
      captureReferenceQueue.close(),
      closePublisher(),
      closeAiDedup(),
      closePushBudget(),
      closeAssignPushBudget(),
      closeGmailDisconnectedPushBudget(),
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
