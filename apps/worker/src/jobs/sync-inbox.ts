import { Worker } from "bullmq";
import { db, countRecurringThreadSorts } from "@amarnai/db";
import { config } from "@amarnai/config";
import {
  GmailClient,
  GmailAuthError,
  GmailHistoryCursorExpiredError,
  normalizeGmailThread,
} from "@amarnai/gmail";
import type { GmailSyncSettings } from "@amarnai/shared";
import {
  isTaxonomyRoutable,
  isBackfillResumable,
  getThreadSortLimit,
  getDraftQuotaWindowStart,
} from "@amarnai/shared";
import {
  classifyThreadQueue,
  backfillInboxQueue,
  QUEUE_SYNC_INBOX,
  type SyncInboxJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import { publishWorkspaceSynced } from "../redis-publisher.js";
import { applyThreadFilter, computeThreadLabelFlags } from "./filter-thread-messages.js";
import { enqueueArmedBacklog } from "./route-armed-backlog.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the receivedAt timestamp of the latest message in the thread that was
 * sent by an address other than the workspace's own email, or null if no such
 * message exists. Used to decide whether a thread's done mark should be cleared
 * when new messages arrive.
 */
export function latestExternalMessageTime(
  messages: Array<{ senderEmail: string; receivedAt: Date }>,
  workspaceEmail: string
): Date | null {
  const external = messages.filter(
    (m) => m.senderEmail.toLowerCase() !== workspaceEmail.toLowerCase()
  );
  if (external.length === 0) return null;
  return external.reduce((latest, m) =>
    m.receivedAt > latest.receivedAt ? m : latest
  ).receivedAt;
}

/**
 * Ensure an EmailAccount row exists for the connected Gmail address and return
 * its internal ID. Mirrors the upsert already used in the API's gmail-sort
 * route so the two flows share the same account record.
 */
async function ensureEmailAccount(
  workspaceId: string,
  ownerUserId: string,
  gmailAddress: string,
  googleSubjectId: string | null,
): Promise<string> {
  const providerAccountId = googleSubjectId ?? gmailAddress;
  const account = await db.emailAccount.upsert({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    create: {
      workspaceId,
      userId: ownerUserId,
      provider: "GMAIL",
      primaryEmailAddress: gmailAddress,
      providerAccountId,
      // GmailConnection is the single authoritative token source.
      // These fields are not used for token refresh and hold only placeholders.
      accessTokenEncrypted: "placeholder",
      refreshTokenEncrypted: "placeholder",
    },
    update: {},
    select: { id: true },
  });
  return account.id;
}

/**
 * Fetch the thread IDs that changed since the stored history cursor.
 * Falls back to a full resync (most-recent 50 threads) when:
 *  - no cursor is stored yet (first run), or
 *  - the cursor has expired (Gmail keeps history for ~7 days).
 *
 * Returns the changed thread IDs and the new cursor to persist.
 */
async function getChangedThreadIds(
  client: GmailClient,
  storedHistoryId: string | null
): Promise<{ changedThreadIds: string[]; newHistoryId: string }> {
  if (!storedHistoryId) {
    const [profile, ids] = await Promise.all([
      client.getProfile(),
      client.listRecentThreadIds(50),
    ]);
    return { changedThreadIds: ids, newHistoryId: profile.historyId };
  }

  try {
    const { changedThreadIds, newHistoryId } = await client.listHistory(storedHistoryId);
    return { changedThreadIds, newHistoryId };
  } catch (err) {
    if (err instanceof GmailHistoryCursorExpiredError) {
      console.warn("[sync-inbox] History cursor expired — performing full resync");
      const [profile, ids] = await Promise.all([
        client.getProfile(),
        client.listRecentThreadIds(50),
      ]);
      return { changedThreadIds: ids, newHistoryId: profile.historyId };
    }
    throw err;
  }
}

/** Max threads recovered per sync cycle per path, bounding queue bursts. */
const QUOTA_RECOVERY_BATCH = 200;

/** Max attempts before a failed thread stops being auto-recovered. */
const MAX_CLASSIFY_ATTEMPTS = 5;

/**
 * Quota-bound a candidate list, stamp classifyingAt, and enqueue LIVE classify
 * jobs at recovery priority. Shared by the quota and failure recovery paths.
 * Returns the number actually enqueued (0 when there is nothing to recover or no
 * remaining monthly capacity). Recovered sorts are tagged LIVE (recurring) and
 * re-check the quota in the worker, so a small concurrent overshoot self-corrects
 * on the next cycle. When enforcement is off there is no cap.
 */
async function enqueueRecovery(
  workspaceId: string,
  plan: string,
  candidates: Array<{ id: string }>,
  dedupPrefix: string,
  extraThreadData: { triageStatus?: "PENDING" } = {},
): Promise<number> {
  if (candidates.length === 0) return 0;

  let recoverable = candidates;
  if (config.billing.enforceThreadSortQuota) {
    const used = await countRecurringThreadSorts(workspaceId, getDraftQuotaWindowStart());
    const remaining = getThreadSortLimit(plan) - used;
    if (remaining <= 0) return 0;
    recoverable = candidates.slice(0, remaining);
  }

  await db.emailThread.updateMany({
    where: { id: { in: recoverable.map((t) => t.id) } },
    data: { classifyingAt: new Date(), ...extraThreadData },
  });

  await classifyThreadQueue.addBulk(
    recoverable.map(({ id: emailThreadId }) => ({
      name: "classify-thread",
      data: { workspaceId, emailThreadId, source: "LIVE" as const },
      opts: {
        deduplication: { id: `${dedupPrefix}_${workspaceId}_${emailThreadId}` },
        priority: 5, // below live sync (1), above backfill (10)
      },
    })),
  );

  return recoverable.length;
}

/**
 * Re-enqueue threads deferred as QUOTA_BLOCKED once the workspace has quota again
 * — on month rollover (the recurring count resets) or a plan upgrade (the limit
 * rises). Caller gates on a strong taxonomy and sorting not being paused,
 * matching the conditions under which live threads are enqueued.
 */
async function recoverQuotaBlockedThreads(workspaceId: string, plan: string): Promise<void> {
  // Cheap existence check first: the common case has nothing deferred, so avoid
  // the COUNT(DISTINCT) recurring-usage query (in enqueueRecovery) unless there
  // is work to recover.
  const blocked = await db.emailThread.findMany({
    where: { workspaceId, triageStatus: "QUOTA_BLOCKED", classifyingAt: null },
    select: { id: true },
    orderBy: { latestMessageAt: "desc" },
    take: QUOTA_RECOVERY_BATCH,
  });
  const recovered = await enqueueRecovery(workspaceId, plan, blocked, "classify_quota_recovery", {
    triageStatus: "PENDING",
  });
  if (recovered > 0) {
    console.log(`[sync-inbox] Workspace ${workspaceId} recovered ${recovered} QUOTA_BLOCKED thread(s)`);
  }
}

/**
 * Re-enqueue threads left PENDING by a permanent classify failure
 * (classifyFailedAt set) so a transient provider/embedding/DB fault self-heals
 * instead of stranding the thread behind the manual "Route now" banner. The
 * invalid-taxonomy bulk backlog has classifyFailedAt = null (never attempted),
 * so it is excluded and stays manual. classifyAttempts bounds retries so a
 * persistently failing thread is not re-enqueued forever. Caller gates on a
 * strong taxonomy and sorting not being paused.
 */
async function recoverFailedThreads(workspaceId: string, plan: string): Promise<void> {
  const failed = await db.emailThread.findMany({
    where: {
      workspaceId,
      triageStatus: "PENDING",
      classifyFailedAt: { not: null },
      classifyingAt: null,
      classifyAttempts: { lt: MAX_CLASSIFY_ATTEMPTS },
    },
    select: { id: true },
    orderBy: { latestMessageAt: "desc" },
    take: QUOTA_RECOVERY_BATCH,
  });
  const recovered = await enqueueRecovery(workspaceId, plan, failed, "classify_failed_recovery");
  if (recovered > 0) {
    console.log(`[sync-inbox] Workspace ${workspaceId} recovered ${recovered} failed thread(s)`);
  }
}

/** A thread with classifyingAt older than this is treated as stuck "Sorting…". */
const STALE_CLASSIFYING_MS = 15 * 60 * 1000;

/**
 * Re-enqueue threads stuck "Sorting…" because classifyingAt was stamped but the
 * job never cleared it (addBulk failed, or the worker died before the job's
 * finally ran). Normal recovery skips these — its filters require
 * classifyingAt: null — so without this they show "Sorting…" forever. A thread
 * that is PENDING with a stale classifyingAt was provably enqueued (the stamp
 * happens only at enqueue time), so it is not the invalid-taxonomy bulk backlog
 * (which has classifyingAt: null) and is safe to re-enqueue. enqueueRecovery
 * re-stamps classifyingAt and re-adds the job. Caller gates on a strong taxonomy
 * and sorting not being paused.
 */
async function recoverStaleClassifyingThreads(workspaceId: string, plan: string): Promise<void> {
  const stale = await db.emailThread.findMany({
    where: {
      workspaceId,
      triageStatus: "PENDING",
      classifyingAt: { lt: new Date(Date.now() - STALE_CLASSIFYING_MS) },
    },
    select: { id: true },
    orderBy: { latestMessageAt: "desc" },
    take: QUOTA_RECOVERY_BATCH,
  });
  const recovered = await enqueueRecovery(workspaceId, plan, stale, "classify_stale_recovery");
  if (recovered > 0) {
    console.log(`[sync-inbox] Workspace ${workspaceId} recovered ${recovered} stale classifying thread(s)`);
  }
}

/**
 * Run a recovery helper without letting its failure fail the sync. Recovery is a
 * best-effort self-heal that runs after the cursor has already advanced and the
 * main sync work has committed; a throw here (e.g. a transient DB error in a
 * recovery query) would otherwise mark the whole sync failed and trigger a retry
 * that re-does the main work for nothing.
 */
async function runRecovery(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("[sync-inbox] Recovery step failed (continuing):", err instanceof Error ? err.message : err);
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function createSyncInboxWorker(): Worker {
  const worker = new Worker<SyncInboxJobData>(
    QUEUE_SYNC_INBOX,
    async (job) => {
      const { workspaceId } = job.data;

      // ── 1. Load workspace + Gmail connection + sync settings ───────────────

      const [workspace, connection, syncSettingsRow] = await Promise.all([
        db.workspace.findUnique({
          where: { id: workspaceId },
          select: { ownerUserId: true, plan: true },
        }),
        db.gmailConnection.findUnique({
          where: { workspaceId },
          select: {
            gmailAddress: true,
            googleSubjectId: true,
            encryptedRefreshToken: true,
            status: true,
          },
        }),
        db.gmailSyncSettings.findUnique({
          where: { workspaceId },
          select: { includeSpam: true, includePromotions: true, sortingPaused: true, routeBulkToOther: true, blacklistedSenderEmails: true },
        }),
      ]);

      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
      if (!connection) throw new Error(`No Gmail connection for workspace: ${workspaceId}`);
      if (connection.status !== "ACTIVE") {
        console.log(`[sync-inbox] Workspace ${workspaceId} Gmail connection is not active — skipping sync`);
        return;
      }

      const settings: GmailSyncSettings = {
        includeSpam:             syncSettingsRow?.includeSpam             ?? false,
        includePromotions:       syncSettingsRow?.includePromotions       ?? false,
        sortingPaused:           syncSettingsRow?.sortingPaused           ?? false,
        routeBulkToOther:        syncSettingsRow?.routeBulkToOther        ?? true,
        blacklistedSenderEmails: syncSettingsRow?.blacklistedSenderEmails ?? [],
      };
      const sortingPaused = settings.sortingPaused;

      // Routing requires enough non-root nodes that are actually reachable from
      // the root (orphaned nodes never receive threads). Load nodes + edges once
      // per sync cycle and reuse the result for the live-sync gate and both
      // backfill triggers.
      const [taxonomyNodes, taxonomyEdges] = await Promise.all([
        db.taxonomyNode.findMany({
          where: { workspaceId },
          select: { id: true, isRoot: true, isCatchAll: true },
        }),
        db.taxonomyEdge.findMany({
          where: { workspaceId },
          select: { sourceNodeId: true, targetNodeId: true },
        }),
      ]);
      const taxonomyStrong = isTaxonomyRoutable(taxonomyNodes, taxonomyEdges);

      // ── 2. Ensure EmailAccount + ProviderSyncState rows exist ───────────────

      const emailAccountId = await ensureEmailAccount(
        workspaceId,
        workspace.ownerUserId,
        connection.gmailAddress,
        connection.googleSubjectId,
      );

      const syncState = await db.providerSyncState.upsert({
        where: { emailAccountId },
        create: { emailAccountId, provider: "GMAIL" },
        update: { status: "SYNCING", errorMessage: null },
        select: {
          historyId: true,
          backfillStatus: true,
          backfillStartedAt: true,
          importantBackfilled: true,
          autoRouteBacklogArmed: true,
        },
      });

      // Kick off the historical backfill as early as possible — right after the
      // sync-state row exists — so its loading card appears within seconds of
      // connecting instead of waiting for this live sync's change discovery and
      // classification to finish. Backfill and live sync are designed to coexist
      // (continuation chunks already run alongside live syncs), and the dedup id
      // collapses duplicate enqueues. Gated on resumability so a completed/active
      // backfill is never restarted; per-plan caps are enforced by the job itself.
      // isBackfillResumable also recovers stale RUNNING state (worker crash).
      if (isBackfillResumable(syncState.backfillStatus, syncState.backfillStartedAt)) {
        await backfillInboxQueue.add(
          "backfill-inbox",
          { workspaceId },
          { deduplication: { id: `backfill-inbox_${workspaceId}` } }
        );
      }

      // ── 3. Discover changed thread IDs ──────────────────────────────────────

      const client = new GmailClient(connection.encryptedRefreshToken);

      // ── 3a. One-time backfill: stamp gmailIsImportant on existing threads ────
      //
      // The gmailIsImportant flag was introduced after many threads were already
      // synced, so all pre-existing rows defaulted to false. Running a targeted
      // is:important query once marks them correctly without a full re-sync.
      // The flag is set to true immediately so this block never runs again.
      if (!syncState.importantBackfilled) {
        const importantIds = await client.listThreadIdsByQuery("is:important", 5_000);
        if (importantIds.length > 0) {
          await db.emailThread.updateMany({
            where: { emailAccountId, providerThreadId: { in: importantIds } },
            data: { gmailIsImportant: true },
          });
        }
        await db.providerSyncState.update({
          where: { emailAccountId },
          data: { importantBackfilled: true },
        });
      }

      const { changedThreadIds, newHistoryId } = await getChangedThreadIds(
        client,
        syncState.historyId
      );
      console.log(
        `[sync-inbox] workspace=${workspaceId} historyId=${syncState.historyId ?? "null"} → ${changedThreadIds.length} changed thread(s)`
      );

      if (changedThreadIds.length === 0) {
        // Nothing changed — advance the cursor, then check whether backfill or
        // failed-thread recovery still needs to run (they must not be skipped just
        // because the inbox was quiet this cycle).
        await db.providerSyncState.update({
          where: { emailAccountId },
          data: { historyId: newHistoryId, lastSyncedAt: new Date(), status: "IDLE" },
        });

        // (The historical backfill was already enqueued right after the sync-state
        // upsert above, so it starts in parallel rather than waiting on this path.)

        // The invalid-taxonomy bulk backlog (PENDING, never attempted) is NOT
        // auto-routed here — it waits for the user's "Route now" so bulk AI
        // routing stays an explicit, cost-controlled action. Threads that were
        // attempted and failed (classifyFailedAt set) DO auto-recover below, and
        // new live threads auto-route in real time (the upserted-thread enqueue).

        // Recover quota-deferred, failed, and stale-classifying threads. Same
        // gating as live classification (strong taxonomy, sorting not paused).
        // Each call is guarded so one recovery query failing does not fail the
        // whole sync after its main work already ran.
        if (!sortingPaused && taxonomyStrong) {
          await runRecovery(() => recoverQuotaBlockedThreads(workspaceId, workspace.plan));
          await runRecovery(() => recoverFailedThreads(workspaceId, workspace.plan));
          await runRecovery(() => recoverStaleClassifyingThreads(workspaceId, workspace.plan));
          // While armed (the user clicked "Route now" during an in-flight
          // backfill), also route the never-attempted PENDING backlog so threads
          // a backfill chunk committed around the click do not re-surface the
          // banner. Cleared by backfill on DONE.
          if (syncState.autoRouteBacklogArmed) {
            await runRecovery(async () => { await enqueueArmedBacklog(workspaceId); });
          }
        }

        return;
      }

      await job.updateProgress(10);

      // ── 4. Fetch, normalize, and upsert each changed thread ─────────────────

      const upsertedEmailThreadIds: string[] = [];
      // Subset of the above whose message set actually changed (a message was
      // added or removed). Gmail's history includes label-only changes (read,
      // star, archive, label add/remove), which touch the thread but leave its
      // content untouched. Re-sorting those would re-pay the embedding + routing
      // cost for no reason, so only content-changed threads are re-classified —
      // matching the rule that new messages, not label changes, trigger sorting.
      const threadsToClassify: string[] = [];

      for (const gmailThreadId of changedThreadIds) {
        let rawThread: unknown;
        try {
          rawThread = await client.getThread(gmailThreadId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("not found")) {
            // Thread was deleted from Gmail — skip without failing the job.
            continue;
          }
          throw err;
        }

        const rawSnapshot = normalizeGmailThread(rawThread);
        // Compute label flags from all messages (before filtering).
        // Stored on the thread so the API can filter at query time without re-fetching.
        const labelFlags = computeThreadLabelFlags(rawSnapshot.messages);
        const snapshot = applyThreadFilter(rawSnapshot, settings);

        if (snapshot === null) {
          // Thread is fully excluded by current settings or always-excluded labels.
          // Persist the flags so the thread is hidden at query time, but don't
          // upsert messages and don't enqueue classification.
          await db.emailThread.upsert({
            where: {
              emailAccountId_providerThreadId: {
                emailAccountId,
                providerThreadId: rawSnapshot.providerThreadId,
              },
            },
            create: {
              workspaceId,
              emailAccountId,
              provider: "GMAIL",
              providerThreadId: rawSnapshot.providerThreadId,
              subject: rawSnapshot.subject,
              latestMessageAt: rawSnapshot.latestMessageAt,
              messageCount: rawSnapshot.messageCount,
              ...labelFlags,
            },
            update: labelFlags,
            select: { id: true },
          });
          continue;
        }

        const emailThread = await db.emailThread.upsert({
          where: {
            emailAccountId_providerThreadId: {
              emailAccountId,
              providerThreadId: snapshot.providerThreadId,
            },
          },
          create: {
            workspaceId,
            emailAccountId,
            provider: "GMAIL",
            providerThreadId: snapshot.providerThreadId,
            subject: snapshot.subject,
            latestMessageAt: snapshot.latestMessageAt,
            messageCount: snapshot.messageCount,
            ...labelFlags,
          },
          update: {
            subject: snapshot.subject,
            latestMessageAt: snapshot.latestMessageAt,
            messageCount: snapshot.messageCount,
            ...labelFlags,
          },
          select: { id: true },
        });

        // Capture the thread's stored message IDs before we upsert/delete, so we
        // can tell afterwards whether this sync actually changed the message set
        // (vs. a label-only change). A brand-new thread has none, so it always
        // counts as changed.
        const priorMessageIds = new Set(
          (
            await db.emailMessage.findMany({
              where: { emailThreadId: emailThread.id, emailAccountId },
              select: { providerMessageId: true },
            })
          ).map((m) => m.providerMessageId)
        );

        // Upsert messages — metadata only, body text is never persisted.
        for (const msg of snapshot.messages) {
          const snippet = msg.bodyExcerpt ? msg.bodyExcerpt.slice(0, 200) : null;
          await db.emailMessage.upsert({
            where: {
              emailAccountId_providerMessageId: {
                emailAccountId,
                providerMessageId: msg.providerMessageId,
              },
            },
            create: {
              workspaceId,
              emailAccountId,
              emailThreadId: emailThread.id,
              providerMessageId: msg.providerMessageId,
              senderEmail: msg.senderEmail,
              senderName: msg.senderName,
              toEmails: msg.toEmails,
              ccEmails: msg.ccEmails,
              bccEmails: [],
              subject: msg.subject,
              snippet,
              bodyText: null,
              receivedAt: msg.receivedAt,
              hasAttachments: msg.attachments.length > 0,
              attachments: msg.attachments.map(({ filename, mimeType }) => ({ filename, mimeType })),
            },
            update: {
              senderName: msg.senderName,
              snippet,
              hasAttachments: msg.attachments.length > 0,
              attachments: msg.attachments.map(({ filename, mimeType }) => ({ filename, mimeType })),
            },
            select: { id: true },
          });
        }

        // Remove messages that are no longer in the Gmail thread. This covers
        // drafts that were replaced by their sent counterpart (different message ID)
        // and messages individually deleted in Gmail. We compare against the raw
        // (unfiltered) snapshot so that messages excluded only by current settings
        // (e.g. promotions) are not removed and can reappear if settings change.
        const rawMessageIds = rawSnapshot.messages.map((m) => m.providerMessageId);
        await db.emailMessage.deleteMany({
          where: {
            emailThreadId: emailThread.id,
            emailAccountId,
            providerMessageId: { notIn: rawMessageIds },
          },
        });

        // Clear done mark if an external message arrived after the thread was
        // marked done. Uses updateMany with a conditional where clause so no
        // extra query is needed when the thread isn't marked done.
        const latestExternal = latestExternalMessageTime(snapshot.messages, connection.gmailAddress);
        if (latestExternal) {
          await db.emailThread.updateMany({
            where: {
              id: emailThread.id,
              resolvedAt: { not: null, lt: latestExternal },
            },
            data: { resolvedByUserId: null, resolvedAt: null },
          });
        }

        upsertedEmailThreadIds.push(emailThread.id);

        // Decide whether the message set changed. A new eligible message we just
        // stored, or a previously-stored message no longer present in Gmail
        // (rawMessageIds, the unfiltered set deleteMany compares against), both
        // count. A pure label change leaves the stored ID set identical, so the
        // thread is touched (flags updated, UI notified) but not re-sorted.
        const rawMessageIdSet = new Set(rawMessageIds);
        const messageAdded = snapshot.messages.some(
          (m) => !priorMessageIds.has(m.providerMessageId)
        );
        const messageRemoved = [...priorMessageIds].some(
          (id) => !rawMessageIdSet.has(id)
        );
        if (messageAdded || messageRemoved) {
          threadsToClassify.push(emailThread.id);
        }
      }

      await job.updateProgress(80);

      // ── 5. Enqueue classify-thread jobs for content-changed threads ──────────
      //
      // Only threads whose message set changed (threadsToClassify) are re-sorted;
      // label-only changes are skipped (see step 4). Their flags are already
      // persisted and the synced event below still refreshes the UI.
      //
      // Priority 1 ensures live sync jobs always outrank backfill jobs (priority 10).
      // Stamp classifyingAt before adding to the queue so isClassifying is true
      // while jobs wait — without this the banner shows "use the sort button".
      // Skip enqueuing when sorting is paused; threads remain PENDING and the
      // resume endpoint re-enqueues them when the user resumes sorting.
      //
      // IMPORTANT: classify enqueue runs BEFORE the cursor is advanced (step 6).
      // If addBulk fails, the job throws and BullMQ retries with the old historyId,
      // so the same changed thread IDs are re-discovered and classification is
      // re-attempted. Advancing the cursor first would lose these threads
      // permanently if addBulk then failed.

      if (threadsToClassify.length > 0) {
        if (!sortingPaused && taxonomyStrong) {
          await db.emailThread.updateMany({
            where: { id: { in: threadsToClassify } },
            data: { classifyingAt: new Date() },
          });

          await classifyThreadQueue.addBulk(
            threadsToClassify.map((emailThreadId) => ({
              name: "classify-thread",
              data: { workspaceId, emailThreadId, source: "LIVE" as const },
              opts: {
                jobId: `classify_${workspaceId}_${emailThreadId}_${Date.now()}`,
                priority: 1,
              },
            }))
          );
        }
        // taxonomy not routable or sorting paused → leave PENDING. The bulk
        // backlog waits for "Route now"; the resume endpoint re-enqueues on
        // resume. (Never-attempted threads have no classifyFailedAt, so
        // recoverFailedThreads deliberately does not touch them.)
      }

      // ── 6. Advance sync cursor ───────────────────────────────────────────────

      await db.providerSyncState.update({
        where: { emailAccountId },
        data: {
          historyId: newHistoryId,
          lastSyncedAt: new Date(),
          status: "IDLE",
          errorMessage: null,
        },
      });

      // Notify connected browser tabs that the inbox changed. Fire-and-forget:
      // a pub/sub failure must never fail the sync job.
      console.log(`[sync-inbox] workspace=${workspaceId} upserted ${upsertedEmailThreadIds.length} thread(s) — publishing synced event`);
      publishWorkspaceSynced(workspaceId).catch((err) => {
        console.error("[sync-inbox] Failed to publish synced event:", err instanceof Error ? err.message : err);
      });

      // (The historical backfill was already enqueued right after the sync-state
      // upsert above, so it starts in parallel rather than waiting for this live
      // sync to finish.)

      // ── 7. Recover deferred and failed threads ───────────────────────────────
      //
      // The invalid-taxonomy bulk backlog (PENDING, never attempted) is left for
      // the user's "Route now" so bulk AI routing stays an explicit, cost-
      // controlled action. Two categories DO auto-recover here: quota-deferred
      // threads once capacity frees up (month rollover or plan upgrade), and
      // threads that were attempted and failed permanently (classifyFailedAt set),
      // so a transient provider/embedding/DB fault self-heals. New live threads
      // auto-route in real time (step 5 above). Same gating as live classification.
      if (!sortingPaused && taxonomyStrong) {
        await runRecovery(() => recoverQuotaBlockedThreads(workspaceId, workspace.plan));
        await runRecovery(() => recoverFailedThreads(workspaceId, workspace.plan));
        await runRecovery(() => recoverStaleClassifyingThreads(workspaceId, workspace.plan));
        // See the quiet-branch comment: route the never-attempted backlog while
        // the "Route now" arm is set during an in-flight backfill.
        if (syncState.autoRouteBacklogArmed) {
          await runRecovery(async () => { await enqueueArmedBacklog(workspaceId); });
        }
      }

      await job.updateProgress(100);
    },
    {
      connection: redisConnection,
      // At most 2 workspace syncs run concurrently in this process.
      concurrency: 2,
      // Sync iterates over changed threads and makes per-thread Gmail API calls.
      // 60 s is generous for a normal sync cycle; lock auto-renews every 30 s.
      lockDuration: 60_000,
      maxStalledCount: 2,
    }
  );

  // Mark sync state as ERROR when a job exhausts all retries.
  // For auth errors (invalid_grant / revoked token) also mark the Gmail
  // connection as DISCONNECTED so the webhook stops enqueuing syncs for it.
  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { workspaceId } = job.data;
    try {
      const isAuthError = err instanceof GmailAuthError;

      if (isAuthError) {
        await db.gmailConnection.update({
          where: { workspaceId },
          data: { status: "DISCONNECTED" },
        });
        console.warn(
          `[sync-inbox] Gmail connection disconnected for workspace ${workspaceId}: ${err.message}`
        );
      }

      const connection = await db.gmailConnection.findUnique({
        where: { workspaceId },
        select: { googleSubjectId: true, gmailAddress: true },
      });
      if (!connection) return;
      const providerAccountId = connection.googleSubjectId ?? connection.gmailAddress;
      const account = await db.emailAccount.findUnique({
        where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
        select: { id: true },
      });
      if (!account) return;
      await db.providerSyncState.update({
        where: { emailAccountId: account.id },
        data: {
          status: "ERROR",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    } catch {
      // Best-effort — don't swallow the original failure.
    }
  });

  return worker;
}
