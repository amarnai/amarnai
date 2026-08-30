import { Queue } from "bullmq";
import { config } from "@aziru/config";
import {
  parseRedisUrl,
  QUEUE_SYNC_INBOX,
  QUEUE_BACKFILL_INBOX,
  QUEUE_GENERATE_TAXONOMY,
} from "@aziru/queue";
import type {
  SyncInboxJobData,
  BackfillInboxJobData,
  GenerateTaxonomyJobData,
} from "@aziru/queue";

const connection = parseRedisUrl(config.redis.url);

/**
 * Lightweight Queue client for the API process.
 * Used only to enqueue jobs — no Worker processor runs here.
 */
export const syncInboxQueue = new Queue<SyncInboxJobData>(QUEUE_SYNC_INBOX, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export const backfillInboxQueue = new Queue<BackfillInboxJobData>(QUEUE_BACKFILL_INBOX, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
});

export const generateTaxonomyQueue = new Queue<GenerateTaxonomyJobData>(QUEUE_GENERATE_TAXONOMY, {
  connection,
  defaultJobOptions: {
    // One LLM call (+ at most one repair). Failures mark FAILED in the row, so
    // a single attempt is enough — no automatic retry storms.
    attempts: 1,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});
