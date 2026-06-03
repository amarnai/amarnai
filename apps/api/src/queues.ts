import { Queue } from "bullmq";
import { parseRedisUrl, QUEUE_CLASSIFY_THREAD } from "@amarnai/queue";
import type { ClassifyThreadJobData } from "@amarnai/queue";
import { config } from "@amarnai/config";

/**
 * Shared classify-thread queue instance for the API process.
 * Used by ai-classify to enqueue background classification jobs.
 */
export const classifyThreadQueue = new Queue<ClassifyThreadJobData>(
  QUEUE_CLASSIFY_THREAD,
  { connection: parseRedisUrl(config.redis.url) }
);
