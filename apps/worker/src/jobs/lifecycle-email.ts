import { Worker } from "bullmq";
import { db, claimIdempotencyToken, releaseIdempotencyToken, lifecycleSendDedupToken } from "@aziru/db";
import { appUrl, sendLifecycleReminderEmail, type LifecycleWorkspaceSummary } from "@aziru/email";
import { signUnsubscribeToken } from "@aziru/auth/unsubscribe-token";
import {
  lifecycleEmailQueue,
  QUEUE_LIFECYCLE_EMAIL,
  type LifecycleEmailJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Self-describing one-click unsubscribe link for this user. */
function buildUnsubscribeUrl(userId: string): string {
  const sig = signUnsubscribeToken(userId);
  return `${appUrl()}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&sig=${sig}`;
}

/** Raw triage counts for one of a user's workspaces. */
export interface WorkspaceTriageCounts {
  workspaceName: string;
  needsReview: number;
  pending: number;
}

/**
 * The single place that decides what "something to report" means. A workspace is
 * included in the digest only when it has threads the user can act on. Today
 * that is NEEDS_REVIEW or PENDING; tune here if the threshold should change.
 * Exported so the rule is unit-testable independently of the DB.
 */
export function summarizeReportable(
  counts: WorkspaceTriageCounts[],
): LifecycleWorkspaceSummary[] {
  return counts
    .filter((c) => c.needsReview > 0 || c.pending > 0)
    .map((c) => ({
      workspaceName: c.workspaceName,
      needsReview: c.needsReview,
      pending: c.pending,
    }));
}

// ─── Job ─────────────────────────────────────────────────────────────────────

/**
 * Sends one weekly lifecycle reminder for a single user. Exported (separate from
 * the BullMQ wiring) so the behavior is unit-testable without Redis.
 *
 * Aggregates the user's inbox status across every workspace they belong to that
 * has an active Gmail connection, builds a single combined digest (per-user, not
 * per-workspace — matching the per-user cost model used for push), and sends it.
 * When there is nothing to report the send is skipped, but `lifecycleEmailSentAt`
 * is still stamped so the cadence stays regular and the user is not re-evaluated
 * on every daily scheduler tick.
 *
 * Idempotent and retry-safe: re-checks eligibility at run time and only stamps
 * the timestamp after the send (or the decision to skip) succeeds, so a failed
 * send is retried rather than silently suppressing the next cycle.
 */
export async function runLifecycleEmailJob(userId: string, idempotencyKey?: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, emailVerified: true, lifecycleEmailsEnabled: true },
  });

  if (!user) {
    console.log(`[lifecycle-email] User ${userId} not found — skipping`);
    return;
  }

  // Safety net: the scheduler already filters on these, but re-check at run time
  // in case the user opted out or became unverified between enqueue and
  // execution. No stamp here — they simply should not have been enqueued.
  if (!user.emailVerified || !user.lifecycleEmailsEnabled) {
    console.log(`[lifecycle-email] User ${userId} not eligible — skipping`);
    return;
  }

  // Workspaces the user belongs to that have an active Gmail connection.
  const memberships = await db.workspaceMember.findMany({
    where: { userId, workspace: { emailConnection: { status: "ACTIVE" } } },
    select: { workspace: { select: { id: true, name: true } } },
  });

  const counts: WorkspaceTriageCounts[] = [];
  for (const { workspace } of memberships) {
    const grouped = await db.emailThread.groupBy({
      by: ["triageStatus"],
      where: { workspaceId: workspace.id },
      _count: { _all: true },
    });
    const countFor = (status: "NEEDS_REVIEW" | "PENDING"): number =>
      grouped.find((g) => g.triageStatus === status)?._count._all ?? 0;
    counts.push({
      workspaceName: workspace.name,
      needsReview: countFor("NEEDS_REVIEW"),
      pending: countFor("PENDING"),
    });
  }

  const workspaces = summarizeReportable(counts);

  if (workspaces.length === 0) {
    // Nothing actionable — skip the send but keep the cadence regular.
    await db.user.update({ where: { id: userId }, data: { lifecycleEmailSentAt: new Date() } });
    console.log(`[lifecycle-email] User ${userId} has nothing to report — send skipped`);
    return;
  }

  // Gate the send on a one-time idempotency claim so a BullMQ retry after a send
  // that succeeded but whose stamp never committed does not re-send the reminder.
  // The token is claimed BEFORE the send and released if the send throws, so a
  // genuine failure still retries; only a completed send keeps the claim. On the
  // hosted product the same token is also handed to Resend, so even the narrow
  // crash-after-send-reached-provider window collapses at the provider.
  // When we have a stable key (the job id), gate the send on a one-time claim so a
  // retry after a send that completed but whose stamp never committed does not
  // re-send. Without a key (a direct/non-BullMQ call) fall OPEN to an unguarded send
  // rather than adopting a per-user-CONSTANT token, which — never released on the
  // success path — would suppress every future weekly reminder for that user.
  const sendToken = idempotencyKey ? lifecycleSendDedupToken(idempotencyKey) : null;
  if (sendToken) {
    const won = await claimIdempotencyToken(sendToken);
    if (!won) {
      // The token was already claimed. This is either a duplicate of a send that
      // completed (the winner stamped lifecycleEmailSentAt, so the cadence is
      // already correct) or the retry of an attempt that claimed the token and then
      // CRASHED before sending. We deliberately do NOT stamp here: stamping would
      // suppress the user for a full week even in the crash case where nothing was
      // sent. Leaving the stamp untouched keeps them eligible so the next daily tick
      // re-enqueues a fresh job (new job.id → new token) and the reminder goes out a
      // day late rather than being lost for the cycle.
      console.log(`[lifecycle-email] User ${userId} reminder already claimed for this job — skipping resend`);
      return;
    }
  }

  try {
    await sendLifecycleReminderEmail(
      user.email,
      {
        name: user.name,
        workspaces,
        unsubscribeUrl: buildUnsubscribeUrl(userId),
      },
      sendToken ? { idempotencyKey: sendToken } : undefined,
    );
  } catch (err) {
    // The send failed — roll back the claim so BullMQ's retry (or the next tick)
    // can re-send. Best-effort: a failed release just means this job won't retry
    // the send, which is the safe direction (no double-send). Only meaningful when
    // a token was claimed (the keyed path).
    if (sendToken) await releaseIdempotencyToken(sendToken).catch(() => {});
    throw err;
  }

  // Stamp only after a successful send so a failed send is retried by BullMQ (or
  // re-enqueued next tick) rather than suppressing the user for a week.
  await db.user.update({ where: { id: userId }, data: { lifecycleEmailSentAt: new Date() } });

  console.log(
    `[lifecycle-email] Sent reminder to user ${userId} across ${workspaces.length} workspace(s)`,
  );
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export function createLifecycleEmailWorker(): Worker {
  const worker = new Worker<LifecycleEmailJobData>(
    QUEUE_LIFECYCLE_EMAIL,
    (job) => runLifecycleEmailJob(job.data.userId, job.id),
    {
      connection: redisConnection,
      // Lightweight jobs (a few queries + one email), so a small pool is plenty.
      concurrency: 5,
    },
  );

  return worker;
}

// Export the queue reference for use in index.ts shutdown logic.
export { lifecycleEmailQueue };
