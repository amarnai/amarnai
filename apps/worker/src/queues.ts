import { Queue } from "bullmq";
import {
  QUEUE_SYNC_INBOX,
  QUEUE_CLASSIFY_THREAD,
  QUEUE_BACKFILL_INBOX,
  QUEUE_LIFECYCLE_EMAIL,
  QUEUE_GENERATE_TAXONOMY,
  QUEUE_PUSH_NOTIFICATION,
  QUEUE_CAPTURE_REFERENCE,
  QUEUE_PROVISION_LABELS,
  QUEUE_WRITEBACK_THREAD_LABEL,
} from "@amarnai/queue";
import { redisConnection } from "./redis.js";

// Re-export so job files can import names and types from one place.
export { QUEUE_SYNC_INBOX, QUEUE_CLASSIFY_THREAD, QUEUE_BACKFILL_INBOX, QUEUE_LIFECYCLE_EMAIL, QUEUE_GENERATE_TAXONOMY, QUEUE_PUSH_NOTIFICATION, QUEUE_CAPTURE_REFERENCE, QUEUE_PROVISION_LABELS, QUEUE_WRITEBACK_THREAD_LABEL } from "@amarnai/queue";
export type { SyncInboxJobData, ClassifyThreadJobData, ClassifyThreadSource, BackfillInboxJobData, LifecycleEmailJobData, GenerateTaxonomyJobData, PushNotificationJobData, CaptureReferenceJobData, ProvisionLabelsJobData, WritebackThreadLabelJobData } from "@amarnai/queue";

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
 * Enqueue a taxonomy generation for a workspace. The generation is one LLM call,
 * but the model (a frontier Gemini tier) intermittently returns transient 503
 * UNAVAILABLE under demand spikes. With a single attempt every such blip became
 * a permanent, user-visible FAILED, so retry with backoff for parity with the
 * other LLM jobs — the worker only records a terminal FAILED on the last attempt.
 * Idempotent: the job re-reads state and re-checks eligibility before the LLM call.
 */
export const generateTaxonomyQueue = new Queue(QUEUE_GENERATE_TAXONOMY, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});

/**
 * Enqueue a push notification (currently only thread-assignment pushes). Two
 * attempts: a duplicate push on retry is tolerable and budget-capped, and the
 * job re-reads the thread and no-ops if the assignment changed, so most retries
 * self-suppress.
 */
export const pushNotificationQueue = new Queue(QUEUE_PUSH_NOTIFICATION, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

/**
 * Enqueue an embedding capture for a manually moved thread's reference row.
 * Embedding-only (no LLM) and idempotent — the job no-ops when the row is gone
 * (undo) or its embeddingTextHash is already current — so retries are cheap.
 */
export const captureReferenceQueue = new Queue(QUEUE_CAPTURE_REFERENCE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

/**
 * Enqueue a folder-label provisioning run for a workspace (mirror every taxonomy
 * folder into the mailbox as a label/category). Idempotent — existing
 * labels/categories are reused — so retries are cheap.
 */
export const provisionLabelsQueue = new Queue(QUEUE_PROVISION_LABELS, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});

/**
 * Enqueue a per-thread label/category reconcile after a classification write.
 * Declarative and idempotent (no-ops when the thread already matches), so a
 * duplicate or retried job is harmless.
 */
export const writebackThreadLabelQueue = new Queue(QUEUE_WRITEBACK_THREAD_LABEL, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});
