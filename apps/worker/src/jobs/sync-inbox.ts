import { Worker } from "bullmq";
import {
  db,
  resolveInboxQuota,
  markGmailConnectionAuthFailed,
  deleteQuotaBlockedNotifications,
  messageSetSignature,
} from "@amarnai/db";
import { config } from "@amarnai/config";
import {
  createMailProvider,
  MailAuthError,
  MailCursorExpiredError,
  MailThreadNotFoundError,
  type MailProvider,
} from "@amarnai/mail";
import type { GmailSyncSettings } from "@amarnai/shared";
import {
  isTaxonomyRoutable,
  isBackfillResumable,
  getThreadSortLimit,
} from "@amarnai/shared";
import {
  classifyThreadQueue,
  backfillInboxQueue,
  pushNotificationQueue,
  QUEUE_SYNC_INBOX,
  type SyncInboxJobData,
} from "../queues.js";
import { DEDUP_CLASSIFY_LIVE } from "@amarnai/queue";
import { redisConnection } from "../redis.js";
import { publishWorkspaceSynced } from "../redis-publisher.js";
import { applyThreadFilter, computeThreadLabelFlags, isSentOnlyThreadSnapshot } from "./filter-thread-messages.js";
import { upsertEmailThread, upsertEmailMessages } from "./persist-thread.js";
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
  provider: "GMAIL" | "OUTLOOK",
  emailAddress: string,
  subjectId: string | null,
): Promise<string> {
  const providerAccountId = subjectId ?? emailAddress;
  const account = await db.emailAccount.upsert({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    create: {
      workspaceId,
      userId: ownerUserId,
      provider,
      primaryEmailAddress: emailAddress,
      providerAccountId,
      // EmailConnection is the single authoritative token source.
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
 * Resolve provider message IDs the delta reported as removed from the inbox
 * (Outlook `@removed` entries: archive / delete / move-out) to the provider
 * thread IDs of the threads that own them, so the caller re-sorts those threads.
 * Matches Gmail, where an INBOX-label removal re-surfaces the whole thread.
 *
 * The removed message is already gone from the provider, so its thread is
 * resolved from our OWN persisted data — we synced the message earlier, and the
 * EmailMessage → EmailThread mapping is keyed by (emailAccountId,
 * providerMessageId). A message ID we never stored yields no row and is silently
 * ignored: there is nothing to re-sort. Gmail passes an empty list, so this is a
 * no-op for it. A DB error propagates so the caller aborts BEFORE advancing the
 * cursor — the same cursor-safety rule the rest of the sync follows, so a failed
 * resolution is retried from the unchanged cursor rather than lost.
 */
async function resolveRemovedThreadIds(
  emailAccountId: string,
  removedMessageIds: string[]
): Promise<string[]> {
  if (removedMessageIds.length === 0) return [];
  const rows = await db.emailMessage.findMany({
    where: { emailAccountId, providerMessageId: { in: removedMessageIds } },
    select: { thread: { select: { providerThreadId: true } } },
  });
  return rows.map((r) => r.thread.providerThreadId);
}

/**
 * Fetch the thread IDs that changed since the stored history cursor.
 * Falls back to a full resync (most-recent 50 threads) when:
 *  - no cursor is stored yet (first run), or
 *  - the cursor has expired (Gmail keeps history for ~7 days).
 *
 * Returns the changed thread IDs and the new cursor to persist. Threads whose
 * only change was an inbox removal (a message archived/deleted/moved out) are
 * folded into the changed set via {@link resolveRemovedThreadIds} so they
 * re-sort too — see there for the Gmail-parity rationale.
 */
async function getChangedThreadIds(
  client: MailProvider,
  storedHistoryId: string | null,
  emailAccountId: string
): Promise<{ changedThreadIds: string[]; sentOnlyCandidateThreadIds: string[]; newCursor: string }> {
  if (!storedHistoryId) {
    // First sync for this inbox: establish the history cursor at "now" and
    // import nothing here. The historical backfill (enqueued in parallel) is the
    // single source of imported threads, so it scans the full inbox newest-first
    // up to the plan cap. Seeding recent threads here too would be a redundant,
    // date-blind second importer. Deltas after this cursor arrive via listHistory.
    const profile = await client.getProfile();
    return { changedThreadIds: [], sentOnlyCandidateThreadIds: [], newCursor: profile.syncCursor };
  }

  try {
    // removedMessageIds and sentOnlyCandidateThreadIds are optional/defaulted so a
    // provider result missing them degrades gracefully (no removals / no sent-only
    // hint → every changed thread fetched) rather than throwing before the cursor
    // advances. Outlook omits both.
    const { changedThreadIds, removedMessageIds = [], sentOnlyCandidateThreadIds = [], newCursor } =
      await client.listChangesSince(storedHistoryId);
    // Resolve inbox-removal message IDs to their threads and merge (deduped) so a
    // thread that only lost/archived a message still re-sorts. Runs before the
    // cursor advances (step 6): a DB failure here throws and BullMQ retries from
    // the same cursor, re-discovering the same @removed entries.
    const removedThreadIds = await resolveRemovedThreadIds(emailAccountId, removedMessageIds);
    return {
      changedThreadIds: Array.from(new Set([...changedThreadIds, ...removedThreadIds])),
      // Threads merged in via removals can never be sent-only candidates (Gmail
      // produces no removals; Outlook produces no candidates), so no interaction.
      sentOnlyCandidateThreadIds,
      newCursor,
    };
  } catch (err) {
    if (err instanceof MailCursorExpiredError) {
      console.warn("[sync-inbox] History cursor expired — performing full resync");
      // Unlike the first-run branch, the seed is kept here on purpose: the cursor
      // expired (>7-day gap) on an already-established inbox whose backfill is
      // long DONE and will not re-run, so these 50 recent threads are genuine
      // catch-up for changes missed during the gap, not a redundant import.
      // listRecentThreadIds returns bare IDs with no labels, so there is no
      // sent-only hint here; the snapshot backstop in the loop catches them.
      const [profile, ids] = await Promise.all([
        client.getProfile(),
        client.listRecentThreadIds(50),
      ]);
      return { changedThreadIds: ids, sentOnlyCandidateThreadIds: [], newCursor: profile.syncCursor };
    }
    throw err;
  }
}

/** Max threads recovered per sync cycle per path, bounding queue bursts. */
const QUOTA_RECOVERY_BATCH = 200;

/** Max attempts before a failed thread stops being auto-recovered. */
const MAX_CLASSIFY_ATTEMPTS = 5;

// messageSetSignature (folded into the LIVE classify dedup key below) now lives in
// @amarnai/db so the thread-summary cache can invalidate on the same signature.

/**
 * Quota-bound a candidate list, stamp classifyingAt, and enqueue LIVE classify
 * jobs at recovery priority. Shared by the quota and failure recovery paths.
 * Returns the number actually enqueued (0 when there is nothing to recover or no
 * remaining monthly capacity). Recovered sorts are tagged LIVE (recurring) and
 * re-check the quota in the worker, so a small concurrent overshoot self-corrects
 * on the next cycle. When enforcement is off there is no cap.
 *
 * The cap is read from the SAME reset-immune, inbox-pooled meter the classify
 * worker gates + accounts on (resolveInboxQuota → InboxUsageMeter), keyed by the
 * connection's inbox address — never a per-workspace EmailClassification count.
 * resetWorkspaceData deletes classifications but not the meter, so this
 * pre-enqueue gate and the worker's accounting gate always read one counter and
 * a disconnect+reconnect cannot refund quota. `plan` is the pooled ceiling.
 */
async function enqueueRecovery(
  workspaceId: string,
  emailAddress: string,
  candidates: Array<{ id: string }>,
  dedupPrefix: string,
  extraThreadData: { triageStatus?: "PENDING" } = {},
): Promise<number> {
  if (candidates.length === 0) return 0;

  let recoverable = candidates;
  if (config.billing.enforceThreadSortQuota) {
    const { plan, used } = await resolveInboxQuota(emailAddress, "THREAD_SORT");
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
async function recoverQuotaBlockedThreads(workspaceId: string, emailAddress: string): Promise<void> {
  // Cheap existence check first: the common case has nothing deferred, so avoid
  // the meter read (in enqueueRecovery) unless there is work to recover.
  const blocked = await db.emailThread.findMany({
    where: { workspaceId, triageStatus: "QUOTA_BLOCKED", classifyingAt: null },
    select: { id: true },
    orderBy: { latestMessageAt: "desc" },
    take: QUOTA_RECOVERY_BATCH,
  });
  const recovered = await enqueueRecovery(workspaceId, emailAddress, blocked, "classify_quota_recovery", {
    triageStatus: "PENDING",
  });
  if (recovered > 0) {
    console.log(`[sync-inbox] Workspace ${workspaceId} recovered ${recovered} QUOTA_BLOCKED thread(s)`);
    // Sorting resumed — clear the "monthly sorting limit reached" nudge. The
    // window marker is left set so recovery within the same window can't re-arm
    // it. Best-effort: never fail the sync.
    await deleteQuotaBlockedNotifications(workspaceId).catch(() => {});
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
async function recoverFailedThreads(workspaceId: string, emailAddress: string): Promise<void> {
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
  const recovered = await enqueueRecovery(workspaceId, emailAddress, failed, "classify_failed_recovery");
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
async function recoverStaleClassifyingThreads(workspaceId: string, emailAddress: string): Promise<void> {
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
  const recovered = await enqueueRecovery(workspaceId, emailAddress, stale, "classify_stale_recovery");
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
          select: { ownerUserId: true },
        }),
        db.emailConnection.findUnique({
          where: { workspaceId },
          select: {
            provider: true,
            emailAddress: true,
            subjectId: true,
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
        // Not consumed by sync filtering — writeback runs off its own job. Kept
        // false here to satisfy the shared type without an extra column select.
        labelWritebackEnabled:   false,
        // Not consumed by sync filtering — read only by the extension's summary
        // request path. Kept true here to satisfy the shared type.
        threadSummaryInjectionEnabled: true,
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
        connection.provider,
        connection.emailAddress,
        connection.subjectId,
      );

      const syncState = await db.providerSyncState.upsert({
        where: { emailAccountId },
        create: { emailAccountId, provider: connection.provider },
        update: { status: "SYNCING", errorMessage: null },
        select: {
          historyId: true,
          backfillStatus: true,
          backfillStartedAt: true,
          backfillRoutingStartedAt: true,
          autoRouteBacklogArmed: true,
        },
      });

      // Live sorting only kicks in once the user has explicitly started backfill
      // routing. Before that, the import runs but new threads are left PENDING so
      // they are swept as BACKFILL (quota-exempt) when routing starts, never as
      // quota-consuming LIVE.
      const routingStarted = syncState.backfillRoutingStartedAt != null;

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

      const client = createMailProvider(connection);

      const { changedThreadIds, sentOnlyCandidateThreadIds, newCursor } = await getChangedThreadIds(
        client,
        syncState.historyId,
        emailAccountId
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
          data: { historyId: newCursor, lastSyncedAt: new Date(), status: "IDLE" },
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
          await runRecovery(() => recoverQuotaBlockedThreads(workspaceId, connection.emailAddress));
          await runRecovery(() => recoverFailedThreads(workspaceId, connection.emailAddress));
          await runRecovery(() => recoverStaleClassifyingThreads(workspaceId, connection.emailAddress));
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

      // ── 3b. Drop sent-only candidates that were never imported ───────────────
      //
      // A candidate is a changed thread whose only delta since the cursor is the
      // user's own outbound mail (SENT without INBOX). If we have never persisted
      // it, it is a sent email awaiting a reply: skip it entirely — no fetch, no
      // row. When the counterpart replies, that inbound message produces fresh
      // history events past the advanced cursor and the thread imports in full
      // then (original sent message included), so nothing is lost.
      //
      // A candidate that IS already persisted (the user replied from Gmail to an
      // imported thread — a lone outbound messagesAdded, hence a candidate) must
      // still be processed so the reply is stored and the thread re-sorts. One
      // findMany over just the candidate IDs tells the two apart.
      let threadIdsToProcess = changedThreadIds;
      if (sentOnlyCandidateThreadIds.length > 0) {
        const candidateSet = new Set(sentOnlyCandidateThreadIds);
        const existingRows = await db.emailThread.findMany({
          where: { emailAccountId, providerThreadId: { in: sentOnlyCandidateThreadIds } },
          select: { providerThreadId: true },
        });
        const existing = new Set(existingRows.map((r) => r.providerThreadId));
        threadIdsToProcess = changedThreadIds.filter(
          (id) => !(candidateSet.has(id) && !existing.has(id))
        );
        const skipped = changedThreadIds.length - threadIdsToProcess.length;
        if (skipped > 0) {
          console.log(
            `[sync-inbox] workspace=${workspaceId} skipped ${skipped} sent-only thread(s) without fetching`
          );
        }
      }

      // ── 4. Fetch, normalize, and upsert each changed thread ─────────────────

      const upsertedEmailThreadIds: string[] = [];
      // Subset of the above whose message set actually changed (a message was
      // added or removed). Gmail's history includes label-only changes (read,
      // star, archive, label add/remove), which touch the thread but leave its
      // content untouched. Re-sorting those would re-pay the embedding + routing
      // cost for no reason, so only content-changed threads are re-classified —
      // matching the rule that new messages, not label changes, trigger sorting.
      // Each entry carries the thread's current message-set signature so the LIVE
      // enqueue dedup key can be content-aware (see messageSetSignature).
      const threadsToClassify: Array<{ id: string; sig: string }> = [];

      for (const gmailThreadId of threadIdsToProcess) {
        let rawSnapshot: Awaited<ReturnType<typeof client.getThreadSnapshot>>;
        try {
          rawSnapshot = await client.getThreadSnapshot(gmailThreadId);
        } catch (err) {
          if (err instanceof MailThreadNotFoundError) {
            // The provider definitively reports the thread as gone (Gmail 404 /
            // empty Graph conversation) — skip it; advancing the cursor past a
            // deleted thread is correct.
            continue;
          }
          // Anything else (auth, 429, 5xx, network) is transient: propagate so
          // the job fails BEFORE the cursor advance in step 6. BullMQ retries
          // from the same historyId and re-diffs the thread — the change is
          // never silently lost. Never classify by message text: a transient
          // error can contain "not found".
          throw err;
        }

        // Snapshot-level sent-only backstop: catches the cursor-expired fallback
        // path (listRecentThreadIds has no label hint) and any candidate the
        // history classifier missed. If the fetched thread is entirely the user's
        // own outbound mail and we have never imported it, skip WITHOUT upserting
        // anything (unlike the excluded path below, which persists flags). An
        // already-imported thread that merely looks sent-only (e.g. an imported
        // note-to-self that was later archived, dropping INBOX) falls through and
        // is processed normally so its flags/messages keep updating.
        if (isSentOnlyThreadSnapshot(rawSnapshot.messages, connection.emailAddress)) {
          const alreadyImported = await db.emailThread.findUnique({
            where: {
              emailAccountId_providerThreadId: {
                emailAccountId,
                providerThreadId: rawSnapshot.providerThreadId,
              },
            },
            select: { id: true },
          });
          if (!alreadyImported) continue;
        }

        // Compute label flags from all messages (before filtering).
        // Stored on the thread so the API can filter at query time without re-fetching.
        const labelFlags = computeThreadLabelFlags(rawSnapshot.messages, connection.emailAddress);
        const snapshot = applyThreadFilter(rawSnapshot, settings);

        if (snapshot === null) {
          // Thread is fully excluded by current settings or always-excluded labels.
          // Persist the flags so the thread is hidden at query time, but don't
          // upsert messages and don't enqueue classification.
          await upsertEmailThread({
            workspaceId,
            emailAccountId,
            provider: connection.provider,
            providerThreadId: rawSnapshot.providerThreadId,
            webLink: rawSnapshot.webLink,
            subject: rawSnapshot.subject,
            latestMessageAt: rawSnapshot.latestMessageAt,
            messageCount: rawSnapshot.messageCount,
            labelFlags,
            updateContent: false,
          });
          continue;
        }

        const emailThreadId = await upsertEmailThread({
          workspaceId,
          emailAccountId,
          provider: connection.provider,
          providerThreadId: snapshot.providerThreadId,
          webLink: snapshot.webLink,
          subject: snapshot.subject,
          latestMessageAt: snapshot.latestMessageAt,
          messageCount: snapshot.messageCount,
          labelFlags,
          updateContent: true,
        });

        // Capture the thread's stored message IDs before we upsert/delete, so we
        // can tell afterwards whether this sync actually changed the message set
        // (vs. a label-only change). A brand-new thread has none, so it always
        // counts as changed.
        const priorMessageIds = new Set(
          (
            await db.emailMessage.findMany({
              where: { emailThreadId, emailAccountId },
              select: { providerMessageId: true },
            })
          ).map((m) => m.providerMessageId)
        );

        // Upsert messages — metadata only, body text is never persisted.
        await upsertEmailMessages({
          workspaceId,
          emailAccountId,
          emailThreadId,
          messages: snapshot.messages,
        });

        // Remove messages that are no longer in the Gmail thread. This covers
        // drafts that were replaced by their sent counterpart (different message ID)
        // and messages individually deleted in Gmail. We compare against the raw
        // (unfiltered) snapshot so that messages excluded only by current settings
        // (e.g. promotions) are not removed and can reappear if settings change.
        const rawMessageIds = rawSnapshot.messages.map((m) => m.providerMessageId);
        await db.emailMessage.deleteMany({
          where: {
            emailThreadId,
            emailAccountId,
            providerMessageId: { notIn: rawMessageIds },
          },
        });

        // Clear done mark if an external message arrived after the thread was
        // marked done. Uses updateMany with a conditional where clause so no
        // extra query is needed when the thread isn't marked done.
        const latestExternal = latestExternalMessageTime(snapshot.messages, connection.emailAddress);
        if (latestExternal) {
          await db.emailThread.updateMany({
            where: {
              id: emailThreadId,
              resolvedAt: { not: null, lt: latestExternal },
            },
            data: { resolvedByUserId: null, resolvedAt: null },
          });
        }

        upsertedEmailThreadIds.push(emailThreadId);

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
          // Signature reflects the NEW message set (rawMessageIds), so a later
          // content change produces a distinct dedup key and is not collapsed into
          // an in-flight classify for the prior content.
          threadsToClassify.push({ id: emailThreadId, sig: messageSetSignature(rawMessageIds) });
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
        if (!sortingPaused && taxonomyStrong && routingStarted) {
          await db.emailThread.updateMany({
            where: { id: { in: threadsToClassify.map((t) => t.id) } },
            data: { classifyingAt: new Date() },
          });

          await classifyThreadQueue.addBulk(
            threadsToClassify.map(({ id: emailThreadId, sig }) => ({
              name: "classify-thread",
              data: { workspaceId, emailThreadId, source: "LIVE" as const },
              opts: {
                // Content-aware dedup key: (workspace, thread, message-set signature).
                // A spurious re-discovery of the SAME content (overlapping historyId, a
                // sync retry, two near-simultaneous syncs) yields the same signature and
                // collapses to one classify job — no double meter/push. A genuinely-new
                // or removed message yields a DIFFERENT signature, so it re-sorts instead
                // of being dropped into an in-flight classify for the old content. The
                // idempotent THREAD_SORT meter (keyed on thread+window, independent of the
                // signature) is still the backstop if two distinct-content jobs overlap.
                deduplication: { id: `${DEDUP_CLASSIFY_LIVE}_${workspaceId}_${emailThreadId}_${sig}` },
                priority: 1,
              },
            }))
          );
        }
        // Sorting paused, taxonomy not routable, or routing not yet started →
        // leave PENDING. Before the user starts backfill routing, new threads are
        // part of the historical backlog and are swept as BACKFILL on start; after
        // that the bulk backlog waits for the start action and the resume endpoint
        // re-enqueues on resume. (Never-attempted threads have no classifyFailedAt,
        // so recoverFailedThreads deliberately does not touch them.)
      }

      // ── 6. Advance sync cursor ───────────────────────────────────────────────

      await db.providerSyncState.update({
        where: { emailAccountId },
        data: {
          historyId: newCursor,
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
        await runRecovery(() => recoverQuotaBlockedThreads(workspaceId, connection.emailAddress));
        await runRecovery(() => recoverFailedThreads(workspaceId, connection.emailAddress));
        await runRecovery(() => recoverStaleClassifyingThreads(workspaceId, connection.emailAddress));
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
      const isAuthError = err instanceof MailAuthError;

      if (isAuthError) {
        // Atomic flip + member notifications on the winning transition; enqueue
        // the push exactly once, only when this call performed the flip.
        const flipped = await markGmailConnectionAuthFailed(workspaceId).catch(() => false);
        if (flipped) {
          await pushNotificationQueue
            .add("push-notification", { kind: "gmail_disconnected", workspaceId })
            .catch(() => {});
        }
        console.warn(
          `[sync-inbox] Gmail connection disconnected for workspace ${workspaceId}: ${err.message}`
        );
      }

      const connection = await db.emailConnection.findUnique({
        where: { workspaceId },
        select: { subjectId: true, emailAddress: true },
      });
      if (!connection) return;
      const providerAccountId = connection.subjectId ?? connection.emailAddress;
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
