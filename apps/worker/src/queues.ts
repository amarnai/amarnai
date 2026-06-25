import { Queue } from "bullmq";
import {
  QUEUE_SYNC_INBOX,
  QUEUE_CLASSIFY_THREAD,
  QUEUE_BACKFILL_INBOX,
  QUEUE_LIFECYCLE_EMAIL,
  QUEUE_GENERATE_TAXONOMY,
} from "@amarnai/queue";
import { redisConnection } from "./redis.js";

// Re-export so job files can import names and types from one place.
export { QUEUE_SYNC_INBOX, QUEUE_CLASSIFY_THREAD, QUEUE_BACKFILL_INBOX, QUEUE_LIFECYCLE_EMAIL, QUEUE_GENERATE_TAXONOMY } from "@amarnai/queue";
export type { SyncInboxJobData, ClassifyThreadJobData, ClassifyThreadSource, BackfillInboxJobData, LifecycleEmailJobData, GenerateTaxonomyJobData } from "@amarnai/queue";

// ─── Queue instances ──────────────────────────────────────────────────────────

/**
 * Enqueue a workspace inbox sync.
 * The `sync-inbox` worker reads ProviderSyncState, calls the Gmail History
 * API, and enqueues `classify-thread` jobs for every changed thread.
 */
export const syncInboxQueue = new Queue(QUEUE_SYNC_INBOX, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

/**
 * Enqueue an AI classification run for a single thread.
 */
export const classifyThreadQueue = new Queue(QUEUE_CLASSIFY_THREAD, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1_000 },
  },
});

/**
 * Enqueue a one-time historical backfill for a workspace.
 * Only 2 retry attempts — if the cursor expires mid-run the job should
 * restart from scratch rather than retrying indefinitely.
 */
export const backfillInboxQueue = new Queue(QUEUE_BACKFILL_INBOX, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
});

/**
 * Enqueue a weekly lifecycle reminder for a single user.
 * One job per due user per cycle; the cadence guard lives on the scheduler
 * (User.lifecycleEmailSentAt), so a missed send is simply retried next tick.
 */
export const lifecycleEmailQueue = new Queue(QUEUE_LIFECYCLE_EMAIL, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

/**
 * Enqueue a taxonomy generation for a workspace. One LLM call per run, so a
 * single attempt — outcome (including failure) is recorded on
 * TaxonomyGenerationState rather than retried by BullMQ.
 */
export const generateTaxonomyQueue = new Queue(QUEUE_GENERATE_TAXONOMY, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});
