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

export interface MaybeCreateExtensionNudgeInput {
  /** The user who just connected Gmail — recipient of the nudge. */
  userId: string;
  /** Workspace the connect happened in; carried for client-side context. */
  workspaceId: string;
}

/**
 * Produce the one-time "install the browser extension" nudge for a user, if and
 * only if they don't already have the extension and have never been nudged.
 *
 * Called (best-effort, fire-and-forget) whenever a user's Gmail is connected —
 * the earliest moment the extension's side panel has real triaged threads to
 * show. Two guards keep it strictly one-time:
 *   1. An `ExtensionInstall` row means they already have it — never nudge. This
 *      also covers connecting *through* the extension (it registers on load).
 *   2. `User.extensionNudgedAt` is set the first time the nudge fires and is
 *      never cleared, so a later reconnect (or the user deleting the bell item)
 *      cannot re-trigger it.
 *
 * The marker flip is done with a conditional `updateMany` (WHERE extensionNudgedAt
 * IS NULL) so two concurrent connects can't both create a notification: only the
 * update that actually flipped the row (count === 1) goes on to create it.
 *
 * Like the other producers here, treat this as best-effort: callers must not fail
 * their critical path if it throws.
 */
export async function maybeCreateExtensionNudge(
  input: MaybeCreateExtensionNudgeInput
): Promise<void> {
  const install = await db.extensionInstall.findUnique({
    where: { userId: input.userId },
    select: { userId: true },
  });
  if (install) return;

  // Atomically claim the one-time slot: only succeeds while the marker is null.
  const claimed = await db.user.updateMany({
    where: { id: input.userId, extensionNudgedAt: null },
    data: { extensionNudgedAt: new Date() },
  });
  if (claimed.count === 0) return;

  await createNotification({
    userId: input.userId,
    workspaceId: input.workspaceId,
    type: "extension_not_installed",
  });
}

/**
 * Remove a user's outstanding "extension_not_installed" nudge. Called when the
 * extension registers, so a user who is nudged and then installs sees the bell
 * item disappear. The durable `User.extensionNudgedAt` marker is intentionally
 * left set — installing must not re-arm the one-time nudge. Best-effort.
 */
export async function deleteExtensionNudgeNotifications(userId: string): Promise<void> {
  await db.notification.deleteMany({
    where: { userId, type: "extension_not_installed" },
  });
}

export interface DeleteThreadAssignedNotificationsInput {
  /** Recipient whose stale assignment notifications should be removed. */
  userId: string;
  /** Workspace scope. */
  workspaceId: string;
  /** Thread the notifications point at (matched inside `params`). */
  threadId: string;
}

/**
 * Remove a recipient's "thread_assigned" notifications for a single thread.
 *
 * Enforces the invariant that at most one active assignment notification exists
 * per (thread, recipient), reflecting the *current* assignment. Callers run this
 * whenever a thread's assignment moves away from a user — on explicit unassign,
 * on reassignment to someone else, and on re-assignment to the same user before
 * a fresh notification is created — so a user never accumulates stale "you were
 * assigned this thread" notices for an assignment they no longer hold.
 *
 * `threadId` lives inside the JSON `params`; there is no index on it, so this is
 * a scan over the recipient's own (already retention-bounded) rows. Like
 * `createNotification`, treat this as best-effort and do not fail the caller's
 * critical path if it throws.
 */
export async function deleteThreadAssignedNotifications(
  input: DeleteThreadAssignedNotificationsInput
): Promise<void> {
  await db.notification.deleteMany({
    where: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      type: "thread_assigned",
      params: { path: ["threadId"], equals: input.threadId },
    },
  });
}
