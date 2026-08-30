import { db } from "@aziru/db";
import { config } from "@aziru/config";
import { PUSH_CATEGORY_THREAD_NEEDS_ATTENTION, PUSH_CHANNEL_TRIAGE } from "@aziru/shared";
import { createRedisSingleton, type RedisSingleton } from "../redis-singleton.js";
import { sendExpoPushMessages, type ExpoPushMessage } from "./expo-push.js";

// ── Per-user push budget ────────────────────────────────────────────────────
//
// Bulk triage (a backfill, or a sync that flips many threads to NEEDS_REVIEW at
// once) can produce a burst of pushes for the same user. We cap the number of
// pushes any single user receives per window so the device is not spammed and,
// on the hosted plan, FCM cost per user stays bounded. The cap is per user (not
// per workspace) because a device belongs to a user and cost is attributed per
// user (CLAUDE.md). A thread emit consumes exactly one budget unit per
// recipient user, regardless of how many devices that user has registered.
const PUSH_BUDGET_LIMIT = 5;
const PUSH_BUDGET_WINDOW_SECONDS = 15 * 60;

// Minimal store surface so the budget check is unit-testable with a stub.
// ioredis satisfies this structurally.
export interface PushBudgetStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

// Fixed-window counter. INCR the user's key and set the TTL on the first hit of
// the window; allowed while the count is within the limit. Pure over the store
// so it can be tested deterministically. Throws if the store throws — the caller
// decides the fail-open/closed policy.
export async function checkPushBudget(
  store: PushBudgetStore,
  userId: string,
  limit: number = PUSH_BUDGET_LIMIT,
  windowSeconds: number = PUSH_BUDGET_WINDOW_SECONDS,
): Promise<boolean> {
  const key = `push:budget:${userId}`;
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, windowSeconds);
  return count <= limit;
}

// Dedicated fail-fast Redis connection for the budget counter, created lazily on
// first use. Kept out of BullMQ's command connection. maxRetriesPerRequest: 1 +
// a short connect timeout so a dead Redis surfaces quickly and the caller can
// fail closed rather than hanging a job. Lazy so merely importing this module
// (e.g. from classify-thread) never requires redis config to be present.
let budgetRedisSingleton: RedisSingleton | null = null;
function budgetRedis(): RedisSingleton {
  if (!budgetRedisSingleton) {
    budgetRedisSingleton = createRedisSingleton(config.redis.url, "push-budget", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
    });
  }
  return budgetRedisSingleton;
}

export async function closePushBudget(): Promise<void> {
  if (budgetRedisSingleton) await budgetRedisSingleton.close();
}

export interface NotifyThreadArgs {
  workspaceId: string;
  emailThreadId: string;
  subject: string | null;
}

export interface NotifyThreadDeps {
  store?: PushBudgetStore;
  send?: typeof sendExpoPushMessages;
}

/**
 * Emits a "thread needs attention" push to every device of every member of the
 * given workspace, subject to each user's push budget.
 *
 * Tenant-scoped: only devices owned by members of `workspaceId` are loaded, so a
 * push can never leak across workspaces. Rate-limited: each recipient user
 * consumes one budget unit; users over budget are skipped silently. The push
 * carries the thread subject (shown on the owner's own device, like Gmail's own
 * notifications) but never the body. Best-effort throughout — a notification
 * failure must never fail or retry the triage job that triggered it.
 */
export async function notifyThreadNeedsAttention(
  args: NotifyThreadArgs,
  deps: NotifyThreadDeps = {},
): Promise<void> {
  const { workspaceId, emailThreadId, subject } = args;
  const send = deps.send ?? sendExpoPushMessages;

  // Tenant scope: devices belonging to members of THIS workspace only.
  const devices = await db.pushDevice.findMany({
    where: { user: { workspaceMemberships: { some: { workspaceId } } } },
    select: { expoPushToken: true, userId: true },
  });
  if (devices.length === 0) return;

  // Resolve the budget store only once we know there is something to send, so a
  // no-recipient workspace never opens a Redis connection.
  const store = deps.store ?? budgetRedis().get();

  // Group tokens by user so the budget is consumed once per user, not per device.
  const tokensByUser = new Map<string, string[]>();
  for (const d of devices) {
    const list = tokensByUser.get(d.userId) ?? [];
    list.push(d.expoPushToken);
    tokensByUser.set(d.userId, list);
  }

  const title = "Thread needs attention";
  const body = subject?.trim() ? subject.trim() : "A new thread needs your review";

  const messages: ExpoPushMessage[] = [];
  let recipientUserCount = 0;
  let suppressedUserCount = 0;

  for (const [userId, tokens] of tokensByUser) {
    let allowed: boolean;
    try {
      allowed = await checkPushBudget(store, userId);
    } catch (err) {
      // Fail closed: when the budget store is unavailable we skip the push
      // rather than risk unbounded FCM cost. A missed triage notification is
      // recoverable (the thread is still visible in-app); runaway spend is not.
      console.error(
        `[notify-threads] Budget store error for user ${userId} (skipping push):`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }
    if (!allowed) {
      suppressedUserCount++;
      continue;
    }

    recipientUserCount++;
    for (const token of tokens) {
      messages.push({
        to: token,
        title,
        body,
        categoryId: PUSH_CATEGORY_THREAD_NEEDS_ATTENTION,
        channelId: PUSH_CHANNEL_TRIAGE,
        data: { workspaceId, emailThreadId, type: PUSH_CATEGORY_THREAD_NEEDS_ATTENTION },
      });
    }
  }

  if (messages.length === 0) return;

  const tickets = await send(messages);
  const errorCount = tickets.filter((t) => t.status === "error").length;

  // Per-user attributable cost record for the hosted plan. Counts only — never
  // the subject or body. Best-effort: an audit write failure must not fail the
  // job.
  console.log(
    `[notify-threads] workspace=${workspaceId} thread=${emailThreadId} pushed to ${recipientUserCount} user(s), ${messages.length} device(s); suppressed=${suppressedUserCount} errors=${errorCount}`,
  );
  await db.auditLog
    .create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        eventType: "push.thread_needs_attention",
        entityType: "EmailThread",
        entityId: emailThreadId,
        metadata: { recipientUserCount, deviceCount: messages.length, suppressedUserCount, errorCount },
      },
    })
    .catch((err) => {
      console.error("[notify-threads] Audit write failed:", err instanceof Error ? err.message : err);
    });
}
