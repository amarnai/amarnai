/**
 * `route-backlog` worker (BACKFILL_BATCH_MODE).
 *
 * Drives `submitBacklogBatch` to embed-batch the PENDING/UNROUTED backlog one
 * chunk at a time, re-enqueueing itself until the backlog is drained. This is the
 * batch-mode implementation of "Route now": it works whether or not a backfill is
 * still running, so the user-facing "route my waiting threads" action routes
 * through the Batch API instead of per-thread online classify jobs.
 */
import { Worker } from "bullmq";
import { QUEUE_ROUTE_BACKLOG, routeBacklogQueue, type RouteBacklogJobData } from "../queues.js";
import { redisConnection } from "../redis.js";
import { submitBacklogBatch } from "./submit-backlog-batch.js";

export function createRouteBacklogWorker(): Worker {
  return new Worker<RouteBacklogJobData>(
    QUEUE_ROUTE_BACKLOG,
    async (job) => {
      const { workspaceId } = job.data;
      const { remaining } = await submitBacklogBatch(workspaceId);
      // More backlog than one chunk → continue on a fresh job so each run stays
      // well under the lock duration and yields to other tenants. Each pass makes
      // progress (threads are either batched or fall back), so this terminates.
      if (remaining) {
        await routeBacklogQueue.add(
          "route-backlog",
          { workspaceId },
          { deduplication: { id: `route_backlog_${workspaceId}` }, delay: 5_000 },
        );
      }
    },
    { connection: redisConnection, concurrency: 3 },
  );
}
