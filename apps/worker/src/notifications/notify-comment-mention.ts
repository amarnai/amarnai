import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { PUSH_CATEGORY_COMMENT_MENTION, PUSH_CHANNEL_TRIAGE } from "@amarnai/shared";
import { createRedisSingleton, type RedisSingleton } from "../redis-singleton.js";
import { sendExpoPushMessages, type ExpoPushMessage } from "./expo-push.js";
import { checkPushBudget, type PushBudgetStore } from "./notify-threads.js";

// Dedicated fail-fast Redis connection for the budget counter, created lazily on
// first use — mirrors notify-thread-assigned. Shares the same
// `push:budget:{userId}` keyspace so all push types draw from one per-user
// budget.
let budgetRedisSingleton: RedisSingleton | null = null;
function budgetRedis(): RedisSingleton {
  if (!budgetRedisSingleton) {
    budgetRedisSingleton = createRedisSingleton(config.redis.url, "push-budget-mention", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
    });
  }
  return budgetRedisSingleton;
}

export async function closeMentionPushBudget(): Promise<void> {
  if (budgetRedisSingleton) await budgetRedisSingleton.close();
}

export interface NotifyCommentMentionArgs {
  workspaceId: string;
  emailThreadId: string;
  /** The comment carrying the mention. */
  commentId: string;
  /** The mentioned user (the only recipient). */
  mentionedUserId: string;
}

export interface NotifyCommentMentionDeps {
  store?: PushBudgetStore;
  send?: typeof sendExpoPushMessages;
}

/**
 * Emits a "you were mentioned in a comment" push to every device of the
 * mentioned user — and only them. Idempotent: re-reads the comment and no-ops if
 * it no longer exists or no longer mentions this user (deleted since enqueue),
 * so a retry never sends a stale push. Rate-limited by the shared per-user
 * budget; fails closed on a budget store error. Carries the thread subject but
 * never the comment body (user-generated, may quote email content). Best-effort.
 */
export async function notifyCommentMention(
  args: NotifyCommentMentionArgs,
  deps: NotifyCommentMentionDeps = {},
): Promise<void> {
  const { workspaceId, emailThreadId, commentId, mentionedUserId } = args;
  const send = deps.send ?? sendExpoPushMessages;

  // Re-read current state. If the comment is gone or the mention was never
  // stored for this user, this job is stale — do nothing (idempotent retry).
  const comment = await db.threadComment.findFirst({
    where: { id: commentId, emailThreadId, workspaceId },
    select: { mentionUserIds: true, emailThread: { select: { subject: true } } },
  });
  if (!comment || !comment.mentionUserIds.includes(mentionedUserId)) return;

  // Only the mentioned user's devices. No cross-user fan-out.
  const devices = await db.pushDevice.findMany({
    where: { userId: mentionedUserId },
    select: { expoPushToken: true },
  });
  if (devices.length === 0) return;

  const store = deps.store ?? budgetRedis().get();
  let allowed: boolean;
  try {
    allowed = await checkPushBudget(store, mentionedUserId);
  } catch (err) {
    // Fail closed: skip rather than risk unbounded FCM cost.
    console.error(
      `[notify-comment-mention] Budget store error for user ${mentionedUserId} (skipping push):`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const suppressed = !allowed;
  const title = "Mentioned in a comment";
  const subject = comment.emailThread.subject?.trim();
  const body = subject ? subject : "You were mentioned in a comment";

  const messages: ExpoPushMessage[] = suppressed
    ? []
    : devices.map((d) => ({
        to: d.expoPushToken,
        title,
        body,
        categoryId: PUSH_CATEGORY_COMMENT_MENTION,
        channelId: PUSH_CHANNEL_TRIAGE,
        data: { workspaceId, emailThreadId, type: PUSH_CATEGORY_COMMENT_MENTION },
      }));

  let errorCount = 0;
  if (messages.length > 0) {
    const tickets = await send(messages);
    errorCount = tickets.filter((t) => t.status === "error").length;
  }

  console.log(
    `[notify-comment-mention] workspace=${workspaceId} thread=${emailThreadId} mentioned=${mentionedUserId} devices=${messages.length} suppressed=${suppressed} errors=${errorCount}`,
  );
  await db.auditLog
    .create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        eventType: "push.comment_mention",
        entityType: "ThreadComment",
        entityId: commentId,
        metadata: { deviceCount: messages.length, suppressed, errorCount },
      },
    })
    .catch((err) => {
      console.error(
        "[notify-comment-mention] Audit write failed:",
        err instanceof Error ? err.message : err,
      );
    });
}
