import { Queue } from "bullmq";
import { QUEUE_CLASSIFY_THREAD } from "@amarnai/queue";
import type { ClassifyThreadJobData } from "@amarnai/queue";
import { config } from "@amarnai/config";

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

/**
 * Shared classify-thread queue instance for the API process.
 * Used by ai-classify to enqueue background classification jobs.
 */
export const classifyThreadQueue = new Queue<ClassifyThreadJobData>(
  QUEUE_CLASSIFY_THREAD,
  { connection: parseRedisUrl(config.redis.url) }
);
