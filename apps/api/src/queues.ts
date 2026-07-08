import { Queue } from "bullmq";
import {
  parseRedisUrl,
  QUEUE_CLASSIFY_THREAD,
  QUEUE_PUSH_NOTIFICATION,
  QUEUE_CAPTURE_REFERENCE,
} from "@amarnai/queue";
import type {
  ClassifyThreadJobData,
  PushNotificationJobData,
  CaptureReferenceJobData,
} from "@amarnai/queue";
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
 * Shared push-notification queue instance for the API process.
 * Used by assign-thread to enqueue a push to the assignee (worker sends it).
 */
export const pushNotificationQueue = new Queue<PushNotificationJobData>(
  QUEUE_PUSH_NOTIFICATION,
  { connection: parseRedisUrl(config.redis.url) }
);

/**
 * Shared capture-reference queue instance for the API process.
 * Used by the triage move endpoint to enqueue the embedding capture for a
 * manually moved thread's TaxonomyNodeReference row (worker fills the vector).
 */
export const captureReferenceQueue = new Queue<CaptureReferenceJobData>(
  QUEUE_CAPTURE_REFERENCE,
  { connection: parseRedisUrl(config.redis.url) }
);
