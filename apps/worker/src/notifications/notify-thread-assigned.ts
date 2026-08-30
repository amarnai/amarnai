import { db } from "@aziru/db";
import { config } from "@aziru/config";
import { PUSH_CATEGORY_THREAD_ASSIGNED, PUSH_CHANNEL_TRIAGE } from "@aziru/shared";
import { createRedisSingleton, type RedisSingleton } from "../redis-singleton.js";
import { sendExpoPushMessages, type ExpoPushMessage } from "./expo-push.js";
import { checkPushBudget, type PushBudgetStore } from "./notify-threads.js";

// Dedicated fail-fast Redis connection for the budget counter, created lazily on
// first use — mirrors notify-threads. Shares the same `push:budget:{userId}`
// keyspace so all push types draw from one per-user budget.
let budgetRedisSingleton: RedisSingleton | null = null;
function budgetRedis(): RedisSingleton {
  if (!budgetRedisSingleton) {
    budgetRedisSingleton = createRedisSingleton(config.redis.url, "push-budget-assign", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
    });
  }
  return budgetRedisSingleton;
}

export async function closeAssignPushBudget(): Promise<void> {
  if (budgetRedisSingleton) await budgetRedisSingleton.close();
}

export interface NotifyThreadAssignedArgs {
  workspaceId: string;
  emailThreadId: string;
  /** The user the thread was assigned to (the only recipient). */
  assigneeUserId: string;
}

export interface NotifyThreadAssignedDeps {
  store?: PushBudgetStore;
  send?: typeof sendExpoPushMessages;
}

/**
 * Emits a "thread assigned to you" push to every device of the assignee — and
 * only the assignee. Idempotent: re-reads the thread and no-ops if the current
 * assignee no longer matches the job's `assigneeUserId` (the assignment was
 * changed or cleared since the job was enqueued), so a retry never sends a stale
 * push. Rate-limited by the shared per-user budget; fails closed on a budget
 * store error. Carries the thread subject but never the body. Best-effort.
 */
export async function notifyThreadAssigned(
  args: NotifyThreadAssignedArgs,
  deps: NotifyThreadAssignedDeps = {},
): Promise<void> {
  const { workspaceId, emailThreadId, assigneeUserId } = args;
  const send = deps.send ?? sendExpoPushMessages;

  // Re-read current state. If the assignment changed since enqueue, this job is
  // stale — do nothing (idempotent retry).
  const thread = await db.emailThread.findFirst({
    where: { id: emailThreadId, workspaceId },
    select: { assignedToUserId: true, subject: true },
  });
  if (!thread || thread.assignedToUserId !== assigneeUserId) return;

  // Only the assignee's devices. No cross-user fan-out.
  const devices = await db.pushDevice.findMany({
    where: { userId: assigneeUserId },
    select: { expoPushToken: true },
  });
  if (devices.length === 0) return;

  const store = deps.store ?? budgetRedis().get();
  let allowed: boolean;
  try {
    allowed = await checkPushBudget(store, assigneeUserId);
  } catch (err) {
    // Fail closed: skip rather than risk unbounded FCM cost.
    console.error(
      `[notify-thread-assigned] Budget store error for user ${assigneeUserId} (skipping push):`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const suppressed = !allowed;
  const title = "Assigned to you";
  const body = thread.subject?.trim() ? thread.subject.trim() : "A thread was assigned to you";

  const messages: ExpoPushMessage[] = suppressed
    ? []
    : devices.map((d) => ({
        to: d.expoPushToken,
        title,
        body,
        categoryId: PUSH_CATEGORY_THREAD_ASSIGNED,
        channelId: PUSH_CHANNEL_TRIAGE,
        data: { workspaceId, emailThreadId, type: PUSH_CATEGORY_THREAD_ASSIGNED },
      }));

  let errorCount = 0;
  if (messages.length > 0) {
    const tickets = await send(messages);
    errorCount = tickets.filter((t) => t.status === "error").length;
  }

  console.log(
    `[notify-thread-assigned] workspace=${workspaceId} thread=${emailThreadId} assignee=${assigneeUserId} devices=${messages.length} suppressed=${suppressed} errors=${errorCount}`,
  );
  await db.auditLog
    .create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        eventType: "push.thread_assigned",
        entityType: "EmailThread",
        entityId: emailThreadId,
        metadata: { deviceCount: messages.length, suppressed, errorCount },
      },
    })
    .catch((err) => {
      console.error(
        "[notify-thread-assigned] Audit write failed:",
        err instanceof Error ? err.message : err,
      );
    });
}
