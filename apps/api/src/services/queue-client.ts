import { Queue } from "bullmq";
import { config } from "@amarnai/config";
import { parseRedisUrl, QUEUE_SYNC_INBOX, QUEUE_BACKFILL_INBOX } from "@amarnai/queue";
import type { SyncInboxJobData, BackfillInboxJobData } from "@amarnai/queue";

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
