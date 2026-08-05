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

export interface CreateWorkspaceNotificationsInput {
  /** Workspace whose members all receive the notification. */
  workspaceId: string;
  /** Producer-defined type, e.g. "backfill_complete". Free-form by design. */
  type: string;
  /** Structured, localization-neutral payload rendered to text on the client. */
  params?: Prisma.InputJsonValue;
}

/**
 * Fan a single notification out to every member of a workspace — one row per
 * member. Used by workspace-level events (backfill finished, quota reached,
 * Gmail disconnected) where there is no single recipient. Per-member creation is
 * best-effort via `Promise.allSettled`: one member's failed insert never blocks
 * the others. Returns the number of members a row was created for.
 *
 * Like the other producers here, treat this as best-effort: callers must not
 * fail their critical path if it throws.
 */
export async function createNotificationsForWorkspaceMembers(
  input: CreateWorkspaceNotificationsInput
): Promise<number> {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: input.workspaceId },
    select: { userId: true },
  });

  const results = await Promise.allSettled(
    members.map((m) =>
      createNotification({
        userId: m.userId,
        workspaceId: input.workspaceId,
        type: input.type,
        // Omit rather than pass `undefined` (exactOptionalPropertyTypes);
        // createNotification defaults an absent params to {}.
        ...(input.params !== undefined ? { params: input.params } : {}),
      })
    )
  );

  return results.filter((r) => r.status === "fulfilled").length;
}

export interface MaybeCreateQuotaBlockedNotificationsInput {
  /** Workspace whose members should be told sorting is paused. */
  workspaceId: string;
  /** Start of the meter window that hit the cap (from `meterWindowStart`). */
  windowStart: Date;
}

/**
 * Produce the "monthly sorting limit reached" (quota_blocked) notification for a
 * workspace, at most once per meter window.
 *
 * A single sync can flip hundreds of threads to QUOTA_BLOCKED; without dedup each
 * would notify. The guard is a monotonic claim on `Workspace.quotaNotifiedWindowStart`
 * via a conditional `updateMany` (WHERE the marker is null or an older window),
 * mirroring the `maybeCreateExtensionNudge` pattern: only the update that actually
 * advances the marker (count === 1) goes on to fan out. Windows are monotonic, so
 * `lt` is the correct comparison and it re-arms cleanly on the next window.
 *
 * The workspace's own `plan` is embedded in the params so the client can decide
 * the click target (upgrade vs informational) without a separate lookup and even
 * when the notification's workspace is not the one currently selected.
 *
 * Best-effort: callers must not fail their critical path if it throws.
 */
export async function maybeCreateQuotaBlockedNotifications(
  input: MaybeCreateQuotaBlockedNotificationsInput
): Promise<void> {
  const claimed = await db.workspace.updateMany({
    where: {
      id: input.workspaceId,
      OR: [
        { quotaNotifiedWindowStart: null },
        { quotaNotifiedWindowStart: { lt: input.windowStart } },
      ],
    },
    data: { quotaNotifiedWindowStart: input.windowStart },
  });
  if (claimed.count === 0) return;

  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { plan: true },
  });
  if (!workspace) return;

  await createNotificationsForWorkspaceMembers({
    workspaceId: input.workspaceId,
    type: "quota_blocked",
    params: { windowStart: input.windowStart.toISOString(), plan: workspace.plan },
  });

  await db.auditLog
    .create({
      data: {
        workspaceId: input.workspaceId,
        actorType: "SYSTEM",
        eventType: "quota.blocked",
        metadata: { windowStart: input.windowStart.toISOString(), plan: workspace.plan },
      },
    })
    .catch(() => {});
}

/**
 * Remove a workspace's "quota_blocked" notifications. Called when sorting
 * recovers (month rollover or plan upgrade re-enqueues the blocked threads), so
 * the "limit reached" nudge disappears once triage resumes. The
 * `quotaNotifiedWindowStart` marker is intentionally left set — recovery within
 * the same window must not re-arm the notification. Best-effort.
 */
export async function deleteQuotaBlockedNotifications(workspaceId: string): Promise<void> {
  await db.notification.deleteMany({
    where: { workspaceId, type: "quota_blocked" },
  });
}

/**
 * Remove a workspace's "gmail_disconnected" notifications. Called when the
 * connection returns to ACTIVE (reconnect) and on explicit user-initiated
 * disconnect, so a stale "reconnect your account" nudge never lingers.
 * Best-effort.
 */
export async function deleteGmailDisconnectedNotifications(workspaceId: string): Promise<void> {
  await db.notification.deleteMany({
    where: { workspaceId, type: "gmail_disconnected" },
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

export interface DeleteCommentMentionNotificationsInput {
  /** Workspace scope. */
  workspaceId: string;
  /** The deleted comment the notifications point at (matched inside `params`). */
  commentId: string;
}

/**
 * Remove every recipient's "comment_mention" notifications for a single comment.
 *
 * Called when a comment is deleted, so a mention notice never outlives the
 * comment it points at (the comment body is gone; the bell item would dead-end).
 * `commentId` lives inside the JSON `params`; there is no index on it, so this is
 * a scan over the workspace's (retention-bounded) rows. Like the other helpers
 * here, treat this as best-effort and do not fail the caller's critical path if
 * it throws.
 */
export async function deleteCommentMentionNotifications(
  input: DeleteCommentMentionNotificationsInput
): Promise<void> {
  await db.notification.deleteMany({
    where: {
      workspaceId: input.workspaceId,
      type: "comment_mention",
      params: { path: ["commentId"], equals: input.commentId },
    },
  });
}
