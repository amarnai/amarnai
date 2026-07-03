import { Prisma } from "@prisma/client";
import { db } from "./client.js";

// In-app notification production. Notifications are generic: a producer supplies
// a recipient, a workspace, a free-form `type` string, and structured `params`.
// Display text is rendered on the client from type+params (localize-at-edges);
// nothing here is user-visible copy, so this helper is feature-agnostic —
// assignment is merely its first caller.

/** Retention window: notification rows older than this are pruned at insert. */
const RETENTION_DAYS = 90;

export interface CreateNotificationInput {
  /** Recipient user id. */
  userId: string;
  /** Workspace the notification relates to (used for client-side deep-linking). */
  workspaceId: string;
  /** Producer-defined type, e.g. "thread_assigned". Free-form by design. */
  type: string;
  /** Structured, localization-neutral payload rendered to text on the client. */
  params?: Prisma.InputJsonValue;
}

/**
 * Create a notification for a recipient and opportunistically prune that
 * recipient's rows older than the retention window. The prune is best-effort and
 * cheap on the [userId, createdAt] index; it keeps the table bounded without a
 * separate cron. Callers should treat notification production as best-effort and
 * not fail their critical path if this throws.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  await db.notification.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      type: input.type,
      params: input.params ?? {},
    },
  });

  await db.notification.deleteMany({
    where: { userId: input.userId, createdAt: { lt: cutoff } },
  });
}
