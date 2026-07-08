import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { PUSH_CATEGORY_GMAIL_DISCONNECTED, PUSH_CHANNEL_TRIAGE } from "@amarnai/shared";
import { createRedisSingleton, type RedisSingleton } from "../redis-singleton.js";
import { sendExpoPushMessages, type ExpoPushMessage } from "./expo-push.js";
import { checkPushBudget, type PushBudgetStore } from "./notify-threads.js";

// Dedicated fail-fast Redis connection for the budget counter, created lazily on
// first use — mirrors notify-threads. Shares the same `push:budget:{userId}`
// keyspace so all push types draw from one per-user budget.
let budgetRedisSingleton: RedisSingleton | null = null;
function budgetRedis(): RedisSingleton {
  if (!budgetRedisSingleton) {
    budgetRedisSingleton = createRedisSingleton(config.redis.url, "push-budget-gmail", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
    });
  }
  return budgetRedisSingleton;
}

export async function closeGmailDisconnectedPushBudget(): Promise<void> {
  if (budgetRedisSingleton) await budgetRedisSingleton.close();
}

export interface NotifyGmailDisconnectedArgs {
  workspaceId: string;
}

export interface NotifyGmailDisconnectedDeps {
  store?: PushBudgetStore;
  send?: typeof sendExpoPushMessages;
}

/**
 * Emits a "Gmail disconnected" push to every device of every member of the
 * workspace whose connection just dropped on an auth failure.
 *
 * Idempotent: re-reads the connection and no-ops unless it is currently
 * DISCONNECTED — so a retry after the user has already reconnected sends nothing.
 * Tenant-scoped: only devices owned by members of `workspaceId` are loaded.
 * Rate-limited by the shared per-user budget; fails closed on a budget store
 * error. Best-effort throughout — a push failure must never fail or retry the
 * job that triggered it.
 */
export async function notifyGmailDisconnected(
  args: NotifyGmailDisconnectedArgs,
  deps: NotifyGmailDisconnectedDeps = {},
): Promise<void> {
  const { workspaceId } = args;
  const send = deps.send ?? sendExpoPushMessages;

  // Re-read current state. If the connection is no longer disconnected (already
  // reconnected since enqueue), this job is stale — do nothing (idempotent retry).
  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { status: true, emailAddress: true },
  });
  if (!connection || connection.status !== "DISCONNECTED") return;

  // Tenant scope: devices belonging to members of THIS workspace only.
  const devices = await db.pushDevice.findMany({
    where: { user: { workspaceMemberships: { some: { workspaceId } } } },
    select: { expoPushToken: true, userId: true },
  });
  if (devices.length === 0) return;

  const store = deps.store ?? budgetRedis().get();

  // Group tokens by user so the budget is consumed once per user, not per device.
  const tokensByUser = new Map<string, string[]>();
  for (const d of devices) {
    const list = tokensByUser.get(d.userId) ?? [];
    list.push(d.expoPushToken);
    tokensByUser.set(d.userId, list);
  }

  const title = "Gmail disconnected";
  const body = connection.emailAddress
    ? `Amarnai lost access to ${connection.emailAddress}. Reconnect to resume email sync.`
    : "Amarnai lost access to your inbox. Reconnect to resume email sync.";

  const messages: ExpoPushMessage[] = [];
  let recipientUserCount = 0;
  let suppressedUserCount = 0;

  for (const [userId, tokens] of tokensByUser) {
    let allowed: boolean;
    try {
      allowed = await checkPushBudget(store, userId);
    } catch (err) {
      // Fail closed: skip rather than risk unbounded FCM cost.
      console.error(
        `[notify-gmail-disconnected] Budget store error for user ${userId} (skipping push):`,
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
        categoryId: PUSH_CATEGORY_GMAIL_DISCONNECTED,
        channelId: PUSH_CHANNEL_TRIAGE,
        data: { workspaceId, type: PUSH_CATEGORY_GMAIL_DISCONNECTED },
      });
    }
  }

  if (messages.length === 0) return;

  const tickets = await send(messages);
  const errorCount = tickets.filter((t) => t.status === "error").length;

  console.log(
    `[notify-gmail-disconnected] workspace=${workspaceId} pushed to ${recipientUserCount} user(s), ${messages.length} device(s); suppressed=${suppressedUserCount} errors=${errorCount}`,
  );
  await db.auditLog
    .create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        eventType: "push.gmail_disconnected",
        metadata: { recipientUserCount, deviceCount: messages.length, suppressedUserCount, errorCount },
      },
    })
    .catch((err) => {
      console.error(
        "[notify-gmail-disconnected] Audit write failed:",
        err instanceof Error ? err.message : err,
      );
    });
}
