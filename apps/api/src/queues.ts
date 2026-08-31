import { Queue } from "bullmq";
import {
  parseRedisUrl,
  QUEUE_CLASSIFY_THREAD,
  QUEUE_PUSH_NOTIFICATION,
  QUEUE_CAPTURE_REFERENCE,
  QUEUE_PROVISION_LABELS,
  QUEUE_WRITEBACK_THREAD_LABEL,
} from "@aziru/queue";
import type {
  ClassifyThreadJobData,
  PushNotificationJobData,
  CaptureReferenceJobData,
  ProvisionLabelsJobData,
  WritebackThreadLabelJobData,
} from "@aziru/queue";
import { config } from "@aziru/config";

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

/**
 * Shared provision-folder-labels queue instance for the API process. Used when a
 * workspace enables label writeback or its taxonomy gains a folder — the worker
 * mirrors every folder into the mailbox as a label/category.
 */
export const provisionLabelsQueue = new Queue<ProvisionLabelsJobData>(
  QUEUE_PROVISION_LABELS,
  { connection: parseRedisUrl(config.redis.url) }
);

/**
 * Shared writeback-thread-label queue instance for the API process. Used after a
 * classification write (manual move / inline sort) to reconcile the thread's
 * Aziru-managed label/category to its current folder.
 */
export const writebackThreadLabelQueue = new Queue<WritebackThreadLabelJobData>(
  QUEUE_WRITEBACK_THREAD_LABEL,
  { connection: parseRedisUrl(config.redis.url) }
);
