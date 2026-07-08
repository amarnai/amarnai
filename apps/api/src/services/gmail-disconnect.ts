import { Job } from "bullmq";
import { db, deleteGmailDisconnectedNotifications, eraseEmailAccountData } from "@amarnai/db";
import { revokeGoogleToken } from "@amarnai/gmail";
import { createMailProvider } from "@amarnai/mail";
import { classifyThreadQueue } from "../queues.js";
import { syncInboxQueue, backfillInboxQueue } from "./queue-client.js";
import { recordAudit } from "./audit.js";

export type DisconnectResult = {
  ok: true;
  erased: boolean;
  revoked: boolean;
  watchStopped: boolean;
  jobsRemoved: number;
  sharedMailbox: boolean;
};

/**
 * Counts ACTIVE connections to the same mailbox in other workspaces, across
 * all tenants. This is the single source of truth for "is this mailbox
 * shared?" — used both to decide whether disconnecting revokes the Google
 * grant and to tell the UI which warning to show, so the two can never drift.
 */
export async function countActiveSiblingConnections(
  emailAddress: string,
  excludeWorkspaceId: string
): Promise<number> {
  return db.emailConnection.count({
    where: {
      emailAddress,
      status: "ACTIVE",
      NOT: { workspaceId: excludeWorkspaceId },
    },
  });
}

/**
 * Sibling workspaces syncing the same mailbox that the given user is a member
 * of. Membership-scoped on purpose: other tenants' workspace names must never
 * be exposed, even though countActiveSiblingConnections counts them.
 */
export async function listVisibleSiblingConnections(
  emailAddress: string,
  excludeWorkspaceId: string,
  userId: string
): Promise<{ id: string; name: string }[]> {
  const siblings = await db.emailConnection.findMany({
    where: {
      emailAddress,
      status: "ACTIVE",
      NOT: { workspaceId: excludeWorkspaceId },
      workspace: { members: { some: { userId } } },
    },
    select: { workspace: { select: { id: true, name: true } } },
  });
  return siblings.map((s) => s.workspace);
}

/**
 * Disconnects a workspace's Gmail connection.
 *
 * - Sets status to DISCONNECTED immediately (stops all new enqueues).
 * - If no other workspace shares the mailbox, stops the Gmail push watch and
 *   revokes the OAuth grant at Google.
 * - Scrubs the stored token.
 * - Removes pending BullMQ jobs for this workspace.
 * - Optionally erases all synced email data.
 * - Writes an audit log entry.
 *
 * Best-effort: revoke/watch-stop failures never block the disconnect.
 */
export async function disconnectGmail(
  workspaceId: string,
  opts: { eraseData: boolean; actorUserId: string | null }
): Promise<DisconnectResult> {
  const { eraseData, actorUserId } = opts;

  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: {
      id: true,
      provider: true,
      emailAddress: true,
      subjectId: true,
      encryptedRefreshToken: true,
      status: true,
    },
  });

  if (!connection) {
    throw new Error(`No Gmail connection found for workspace: ${workspaceId}`);
  }

  // ── 1. Flip status immediately ────────────────────────────────────────────
  // This stops the scheduler, webhook, and all enqueue paths from adding new
  // work before we do anything else.
  await db.emailConnection.update({
    where: { workspaceId },
    data: { status: "DISCONNECTED" },
  });

  // An explicit user-initiated disconnect must not leave a stale automatic
  // "reconnect your account" nudge (and must never create one). Best-effort.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  // ── 2. Shared-mailbox check ───────────────────────────────────────────────
  // Google-side teardown (watch stop + token revocation) is scoped to the
  // mailbox/grant, not to this workspace. Skip it when another ACTIVE workspace
  // shares the same address so we don't break their sync.
  const siblingsCount = await countActiveSiblingConnections(
    connection.emailAddress,
    workspaceId
  );
  const sharedMailbox = siblingsCount > 0;

  let watchStopped = false;
  let revoked = false;

  if (!sharedMailbox && connection.encryptedRefreshToken) {
    // ── 3. Stop push watch (needs a valid token, so runs before revoke) ──────
    try {
      const client = createMailProvider(connection);
      await client.stopWatch();
      watchStopped = true;
    } catch (err) {
      console.warn(
        "[gmail-disconnect] Watch stop failed (non-fatal):",
        err instanceof Error ? err.message : err
      );
    }

    // ── 4. Revoke OAuth grant ─────────────────────────────────────────────────
    // Gmail exposes a token-revoke endpoint; Microsoft does not (revocation is
    // user-driven via the MS account permissions page — surfaced in the UI). For
    // Outlook, stopWatch above already deleted the Graph subscriptions and the
    // stored token is scrubbed below, so there is nothing more to call here.
    if (connection.provider === "GMAIL") {
      revoked = await revokeGoogleToken(connection.encryptedRefreshToken);
      if (!revoked) {
        console.warn("[gmail-disconnect] Token revocation failed or token already invalid");
      }
    }
  }

  // ── 5. Scrub stored tokens ────────────────────────────────────────────────
  await db.emailConnection.update({
    where: { workspaceId },
    data: { encryptedRefreshToken: "", watchExpiresAt: null },
  });

  const providerAccountId = connection.subjectId ?? connection.emailAddress;
  const emailAccount = await db.emailAccount.findUnique({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    select: { id: true },
  });
  if (emailAccount) {
    await db.emailAccount.update({
      where: { id: emailAccount.id },
      data: { refreshTokenEncrypted: "placeholder" },
    });
  }

  // ── 6. Cancel pending jobs ────────────────────────────────────────────────
  let jobsRemoved = 0;

  // classify-thread: scan waiting/delayed/prioritized jobs for this workspace.
  // Live-sync jobs use timestamped jobIds so dedup-id lookup can't find them;
  // we must scan the queue and filter by workspaceId.
  const PAGE_SIZE = 500;
  let start = 0;
  while (true) {
    const jobs = await classifyThreadQueue.getJobs(
      ["waiting", "delayed", "prioritized"],
      start,
      start + PAGE_SIZE - 1
    );
    for (const job of jobs) {
      if (job.data.workspaceId === workspaceId) {
        try {
          const state = await job.getState();
          if (state === "waiting" || state === "delayed" || state === "prioritized") {
            await job.remove();
            jobsRemoved++;
          }
        } catch {
          // Job may have turned active between listing and removal — ignore.
        }
      }
    }
    if (jobs.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }

  // sync-inbox and backfill-inbox: exactly one dedup id each.
  for (const [queue, key] of [
    [syncInboxQueue, `sync-inbox_${workspaceId}`],
    [backfillInboxQueue, `backfill-inbox_${workspaceId}`],
  ] as const) {
    try {
      const jobId = await queue.getDeduplicationJobId(key);
      if (jobId) {
        const job = await Job.fromId(queue, jobId);
        if (job) {
          const state = await job.getState();
          if (state === "waiting" || state === "delayed" || state === "prioritized") {
            await job.remove();
            jobsRemoved++;
          }
        }
      }
    } catch {
      // Non-fatal best-effort removal.
    }
  }

  // Clear classifyingAt so threads don't show as "Queued" after jobs are removed.
  await db.emailThread.updateMany({
    where: { workspaceId, classifyingAt: { not: null } },
    data: { classifyingAt: null },
  });

  // ── 7. Optionally erase synced email data ─────────────────────────────────
  // Shared with inbox-rotation cleanup so the FK-safe delete order lives in one
  // place. Scrubs this mailbox only; taxonomy and settings are kept.
  let erased = false;
  if (eraseData && emailAccount) {
    await eraseEmailAccountData(emailAccount.id);
    erased = true;
  }

  // ── 8. Audit log ──────────────────────────────────────────────────────────
  await recordAudit({
    workspaceId,
    actorType: "USER",
    actorUserId,
    eventType: "gmail.disconnected",
    entityType: "GmailConnection",
    entityId: connection.id,
    metadata: {
      gmailAddress: connection.emailAddress,
      eraseData,
      revoked,
      watchStopped,
      jobsRemoved,
      sharedMailbox,
    },
  });

  return { ok: true, erased, revoked, watchStopped, jobsRemoved, sharedMailbox };
}
