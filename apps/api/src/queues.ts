import { Queue } from "bullmq";
import { parseRedisUrl, QUEUE_CLASSIFY_THREAD, QUEUE_ROUTE_BACKLOG } from "@amarnai/queue";
import type { ClassifyThreadJobData, RouteBacklogJobData } from "@amarnai/queue";
import { config } from "@amarnai/config";

/**
 * Shared classify-thread queue instance for the API process.
 * Used by ai-classify to enqueue background classification jobs.
 */
export const classifyThreadQueue = new Queue<ClassifyThreadJobData>(
  QUEUE_CLASSIFY_THREAD,
  { connection: parseRedisUrl(config.redis.url) }
);

/**
 * Route-backlog queue (BACKFILL_BATCH_MODE). "Route now" enqueues this instead of
 * per-thread classify jobs when batch mode is on, so the backlog is embed-batched.
 */
export const routeBacklogQueue = new Queue<RouteBacklogJobData>(
  QUEUE_ROUTE_BACKLOG,
  { connection: parseRedisUrl(config.redis.url) }
);
