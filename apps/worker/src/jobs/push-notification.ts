import { Worker } from "bullmq";
import {
  QUEUE_PUSH_NOTIFICATION,
  type PushNotificationJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import { notifyThreadAssigned } from "../notifications/notify-thread-assigned.js";

/**
 * Processes `push-notification` jobs. A discriminated union on `data.kind` lets
 * future push producers slot in without a new queue or worker. Each handler is
 * idempotent (re-reads state, no-ops if stale), so BullMQ retries are safe.
 */
export function createPushNotificationWorker(): Worker<PushNotificationJobData> {
  return new Worker<PushNotificationJobData>(
    QUEUE_PUSH_NOTIFICATION,
    async (job) => {
      const data = job.data;
      switch (data.kind) {
        case "thread_assigned":
          await notifyThreadAssigned({
            workspaceId: data.workspaceId,
            emailThreadId: data.emailThreadId,
            assigneeUserId: data.assigneeUserId,
          });
          return;
        default: {
          // Exhaustiveness guard: a new kind must add a case above.
          const _exhaustive: never = data.kind;
          throw new Error(`Unknown push-notification kind: ${String(_exhaustive)}`);
        }
      }
    },
    { connection: redisConnection },
  );
}
