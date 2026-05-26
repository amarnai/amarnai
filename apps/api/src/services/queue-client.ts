import { Queue } from "bullmq";
import { config } from "@amarnai/config";
import { QUEUE_SYNC_INBOX } from "@amarnai/queue";
import type { SyncInboxJobData } from "@amarnai/queue";

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

/**
 * Lightweight Queue client for the API process.
 * Used only to enqueue jobs — no Worker processor runs here.
 */
export const syncInboxQueue = new Queue<SyncInboxJobData>(QUEUE_SYNC_INBOX, {
  connection: parseRedisUrl(config.redis.url),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});
