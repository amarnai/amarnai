import { Worker } from "bullmq";
import { db } from "@amarnai/db";
import { GmailClient, GmailAuthError, GmailThreadMeta, normalizeGmailThread } from "@amarnai/gmail";
import type { GmailSyncSettings } from "@amarnai/shared";
import { isTaxonomyRoutable, getBackfillCap, BACKFILL_RUNNING_STALE_MS } from "@amarnai/shared";
import {
  backfillInboxQueue,
  QUEUE_BACKFILL_INBOX,
  type BackfillInboxJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import { publishWorkspaceSynced } from "../redis-publisher.js";
import {
  applyThreadFilter,
  computeThreadLabelFlags,
  computeThreadLabelFlagsFromMeta,
  isThreadExcluded,
} from "./filter-thread-messages.js";
import { enqueueArmedBacklog } from "./route-armed-backlog.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/** threads.list page size per Gmail request. */
const BACKFILL_PAGE_SIZE = 100;

/**
 * Maximum threads processed in a single job run before persisting the cursor
 * and re-enqueuing a continuation. Bounds each run's wall-clock time well under
 * the BullMQ lock duration and yields the queue to other tenants between chunks,
 * so even a 250k-thread cap completes across many short runs.
 */
const BACKFILL_CHUNK_THREADS = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A permanent, thread-specific failure: this one thread cannot be fetched or
 * parsed and never will be (e.g. it was deleted, or its data is malformed). The
 * backfill skips it and moves on instead of failing the whole run.
 *
 * Systemic and transient failures (auth, rate limits, 5xx, network, DB) are NOT
 * wrapped in this — they propagate so the run aborts and resumes from its cursor.
 */
class SkippableThreadError extends Error {
  constructor(public readonly threadId: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`unprocessable thread ${threadId}: ${reason}`);
    this.name = "SkippableThreadError";
  }
}

/**
 * True when a getThread failure is permanent for that single thread — a 404 /
 * "not found" (deleted) or a 400 (bad request). Auth, rate-limit (429), server
 * (5xx) and network errors are transient or systemic and must propagate so the
 * run retries rather than silently skipping threads.
 */
function isPermanentThreadFetchError(err: unknown): boolean {
  if (err instanceof GmailAuthError) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("not found")) return true;
  const status = Number(msg.match(/fetch failed: (\d+)/)?.[1]);
  return status === 400 || status === 404;
}

/**
 * Sort threads strictly by latestMessageAt descending (most recent first). When
 * the plan cap truncates the inbox, the kept set is the most recent threads —
 * matching what a user expects to see, and composing with the Free plan's 30-day
 * window. Read state is intentionally not a factor.
 */
function sortByPriority(threads: GmailThreadMeta[]): GmailThreadMeta[] {
  return [...threads].sort(
    (a, b) => b.latestMessageAt.getTime() - a.latestMessageAt.getTime(),
  );
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function createBackfillInboxWorker(): Worker {
  const worker = new Worker<BackfillInboxJobData>(
    QUEUE_BACKFILL_INBOX,
    async (job) => {
      const { workspaceId } = job.data;

      // ── 1. Load workspace + Gmail connection + sync settings ───────────────

      const [workspace, connection, syncSettingsRow] = await Promise.all([
        db.workspace.findUnique({
          where: { id: workspaceId },
          select: { ownerUserId: true, plan: true, billingCycle: true },
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
        console.log(`[backfill-inbox] Workspace ${workspaceId} Gmail connection is not active — skipping backfill`);
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

      // ── 2. Resolve the EmailAccount and current ProviderSyncState ───────────

      const providerAccountId = connection.googleSubjectId ?? connection.gmailAddress;
      const emailAccount = await db.emailAccount.findUnique({
        where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
        select: { id: true },
      });
      if (!emailAccount) {
        throw new Error(`EmailAccount not found for workspace: ${workspaceId}`);
      }
      const emailAccountId = emailAccount.id;

      // Pre-claim read: only the status, for a cheap short-circuit. The cursor is
      // read AFTER the claim (below) so it can't be moved by another worker
      // between the read and the claim.
      const preClaim = await db.providerSyncState.findUnique({
        where: { emailAccountId },
        select: { backfillStatus: true },
      });

      if (!preClaim) {
        console.log(`[backfill-inbox] Workspace ${workspaceId} has no sync state yet — skipping`);
        return;
      }
      if (preClaim.backfillStatus === "DONE") {
        console.log(`[backfill-inbox] Workspace ${workspaceId} backfill already DONE — skipping`);
        return;
      }

      // ── 3. Atomically claim this chunk ──────────────────────────────────────
      // A single conditional update is the lock: it only succeeds when the row is
      // claimable (PENDING/ERROR, or RUNNING whose started-at is cleared between
      // chunks or stale after a crash). The DB serialises competing claims, so
      // exactly one worker wins; the others get count 0 and skip. This replaces
      // the old read-then-write guard, which two processes could both pass.

      const now = new Date();
      const staleBefore = new Date(now.getTime() - BACKFILL_RUNNING_STALE_MS);
      const claim = await db.providerSyncState.updateMany({
        where: {
          emailAccountId,
          OR: [
            { backfillStatus: { in: ["PENDING", "ERROR"] } },
            { backfillStatus: "RUNNING", backfillStartedAt: null },
            { backfillStatus: "RUNNING", backfillStartedAt: { lt: staleBefore } },
          ],
        },
        data: { backfillStatus: "RUNNING", backfillStartedAt: now },
      });
      if (claim.count === 0) {
        console.log(`[backfill-inbox] Workspace ${workspaceId} backfill not claimable (running elsewhere) — skipping`);
        return;
      }

      // The claim just flipped the status to RUNNING. Notify SSE subscribers now,
      // before the first (latency-heavy) page fetch, so the loading card appears
      // immediately in its "preparing" state rather than only once the first page
      // of thread metadata has been pulled.
      publishWorkspaceSynced(workspaceId).catch((err) => {
        console.error("[backfill-inbox] Failed to publish synced event:", err instanceof Error ? err.message : err);
      });

      // Post-claim read: now that we are the sole owner, the resume cursor and
      // generation are authoritative — no other worker can advance them until we
      // release. A chunk persists its cursor and clears started-at in one atomic
      // write, so the row only becomes claimable once the cursor is up to date.
      const claimed = await db.providerSyncState.findUnique({
        where: { emailAccountId },
        select: {
          backfillPageToken: true,
          backfillProcessedCount: true,
          backfillSkipped: true,
          backfillGeneration: true,
          autoRouteBacklogArmed: true,
        },
      });

      // The generation we are responsible for. A concurrent reset (sweep bumps
      // it) makes our later progress writes no-ops, so the reset is never clobbered.
      const claimedGeneration = claimed?.backfillGeneration ?? 0;
      // Set when the user clicked "Route now" mid-backfill: route the arriving
      // historical backlog automatically instead of re-prompting (cleared below
      // when the backfill reaches a terminal state).
      const autoRouteBacklogArmed = claimed?.autoRouteBacklogArmed ?? false;

      await job.updateProgress(5);

      try {
        // ── 5. Resolve the plan cap and resume cursor ──────────────────────────
        //
        // Thread count + look-back window come from the workspace plan + billing
        // cycle (single source of truth in @amarnai/shared). Paid plans have no
        // time window (windowDays === null → afterMs 0 → full history); Free is
        // bounded to its 30-day / 500-thread cap. Large caps are processed across
        // multiple runs, resuming from the persisted pageToken / processed count.

        const cap = getBackfillCap(workspace.plan, workspace.billingCycle);

        const client = new GmailClient(connection.encryptedRefreshToken);
        const nowMs = Date.now();
        const afterMs = cap.windowDays === null ? 0 : nowMs - cap.windowDays * MS_PER_DAY;

        let pageToken = claimed?.backfillPageToken ?? undefined;
        let processed = claimed?.backfillProcessedCount ?? 0;

        // ── Per-thread upsert: returns the EmailThread id to classify, or null ──
        //
        // Threads already present (picked up by a live sync) only have their label
        // flags refreshed; we still classify them if they are PENDING and not
        // excluded. New threads are fetched in full, filtered, and persisted.
        async function processThread(gmailThread: GmailThreadMeta): Promise<string | null> {
          const existing = await db.emailThread.findUnique({
            where: {
              emailAccountId_providerThreadId: { emailAccountId, providerThreadId: gmailThread.id },
            },
            select: { id: true, triageStatus: true },
          });

          if (existing) {
            const flagsFromMeta = computeThreadLabelFlagsFromMeta(gmailThread.messageLabelIds);
            // Always update stored flags so query-time filtering reflects current Gmail state.
            await db.emailThread.update({ where: { id: existing.id }, data: flagsFromMeta });

            const excluded = isThreadExcluded(flagsFromMeta, settings);
            return !excluded && existing.triageStatus === "PENDING" ? existing.id : null;
          }

          // New thread: fetch full data, compute flags, apply filter. A failure
          // that is permanent for this one thread is rethrown as a
          // SkippableThreadError so the caller skips it; everything else (auth,
          // rate limits, 5xx, network) propagates to abort and retry the run.
          let rawFull: unknown;
          try {
            rawFull = await client.getThread(gmailThread.id);
          } catch (err) {
            if (isPermanentThreadFetchError(err)) throw new SkippableThreadError(gmailThread.id, err);
            throw err;
          }

          let rawSnapshot: ReturnType<typeof normalizeGmailThread>;
          let labelFlags: ReturnType<typeof computeThreadLabelFlags>;
          let snapshot: ReturnType<typeof applyThreadFilter>;
          try {
            rawSnapshot = normalizeGmailThread(rawFull);
            labelFlags = computeThreadLabelFlags(rawSnapshot.messages);
            snapshot = applyThreadFilter(rawSnapshot, settings);
          } catch (err) {
            // Malformed thread data — permanent for this thread, never retryable.
            throw new SkippableThreadError(gmailThread.id, err);
          }

          if (snapshot === null) {
            // Fully excluded — persist with flags so query-time filtering works,
            // but don't upsert messages and don't enqueue classification.
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
            return null;
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

          return emailThread.id;
        }

        // ── 6. Process pages until the chunk budget or the plan cap is reached ──

        const baseSkipped = claimed?.backfillSkipped ?? 0;
        let runSkipped = 0;
        let processedThisRun = 0;
        let exhausted = false;
        let disconnected = false;
        // Gmail's estimate of total threads matching the windowed query, captured
        // from the most recent page. Used to estimate how many sit beyond the cap.
        let resultSizeEstimate = 0;

        // Gmail's estimate of the total matching threads, capped at the plan cap
        // and floored at what we've already processed so the UI's loading bar can't
        // exceed 100% or run backwards on estimate jitter.
        const totalEstimateFor = (count: number) =>
          Math.max(count, Math.min(resultSizeEstimate, cap.maxThreads));

        while (processedThisRun < BACKFILL_CHUNK_THREADS && processed < cap.maxThreads) {
          const page = await client.listThreadsPage({
            afterMs,
            pageToken,
            pageSize: BACKFILL_PAGE_SIZE,
          });
          resultSizeEstimate = page.resultSizeEstimate;

          // An empty page means we've reached the end of the inbox.
          if (page.threads.length === 0) {
            exhausted = true;
            break;
          }

          // Don't exceed the plan cap: only take as many threads as remain.
          const remaining = cap.maxThreads - processed;
          const pageThreads = sortByPriority(page.threads).slice(0, remaining);

          for (let i = 0; i < pageThreads.length; i++) {
            try {
              await processThread(pageThreads[i]!);
            } catch (err) {
              // Permanent per-thread failure: skip it and keep going so one bad
              // thread can never stall the backfill. Anything else propagates.
              if (!(err instanceof SkippableThreadError)) throw err;
              runSkipped++;
              console.warn(`[backfill-inbox] Workspace ${workspaceId} skipping ${err.message}`);
            }

            // Check for disconnect periodically so a long run stops promptly.
            if ((processed + i) % 50 === 0) {
              const currentConn = await db.gmailConnection.findUnique({
                where: { workspaceId },
                select: { status: true },
              });
              if (!currentConn || currentConn.status !== "ACTIVE") {
                disconnected = true;
                break;
              }
            }
          }

          processed += pageThreads.length;
          processedThisRun += pageThreads.length;
          pageToken = page.nextPageToken;

          if (disconnected) break;

          // Notify SSE subscribers after each page so the thread list refreshes as
          // history loads. We do NOT write backfillProcessedCount here: the count
          // shown on the card is derived from the actual thread rows in
          // sync-status (exact and live, including live-synced threads), and
          // backfillProcessedCount stays in lockstep with the resume cursor, which
          // only the chunk-end write advances. Skipped on the final page — the
          // chunk-end / DONE write below publishes the settled state.
          if (page.nextPageToken) {
            publishWorkspaceSynced(workspaceId).catch((err) => {
              console.error("[backfill-inbox] Failed to publish synced event:", err instanceof Error ? err.message : err);
            });
          }

          if (!page.nextPageToken) {
            exhausted = true;
            break;
          }
          // If the page was cap-trimmed, the while condition ends the loop next.
        }

        // ── 7. Disconnected mid-run: reset to PENDING and drop the cursor ───────
        // The Gmail pageToken may be stale by the time the user reconnects, so we
        // restart the backfill from scratch (already-synced threads are skipped
        // cheaply via the existing-row check).
        if (disconnected) {
          console.log(
            `[backfill-inbox] Workspace ${workspaceId} disconnected mid-backfill — resetting to PENDING`
          );
          await db.providerSyncState.updateMany({
            where: { emailAccountId, backfillGeneration: claimedGeneration },
            data: {
              backfillStatus: "PENDING",
              backfillStartedAt: null,
              backfillPageToken: null,
              backfillProcessedCount: 0,
              backfillTotalEstimate: 0,
              backfillSkipped: 0,
            },
          });
          return;
        }

        await job.updateProgress(60);

        // ── 8. Route the imported backlog only after the user has started ───────
        //
        // The import never routes on its own: bulk AI routing is an explicit user
        // action ("Start sorting"). Only when armed — the user started backfill
        // routing while this import is still in flight — do we sweep the
        // never-attempted PENDING backlog (this run's upserts plus any orphaned)
        // as BACKFILL, so threads a chunk commits around the click are routed too.
        // Otherwise threads stay PENDING and wait for the start action. Skipped
        // when sorting is paused; threads stay PENDING for the resume flow.
        if (!sortingPaused && autoRouteBacklogArmed) {
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

          if (isTaxonomyRoutable(taxonomyNodes, taxonomyEdges)) {
            await enqueueArmedBacklog(workspaceId);
          }
        }

        // ── 9. More to do? Persist the cursor and re-enqueue a continuation ─────
        // Status stays RUNNING (so the UI banner stays up) but backfillStartedAt
        // is cleared, releasing the active lock so the next run can claim it. The
        // write is guarded on our generation: if a sweep reset the backfill mid-
        // run it won't match, so we don't overwrite the reset (count 0). The
        // continuation is added WITHOUT deduplication (this still-active job may
        // hold the dedup key) and runs regardless: it either resumes from the
        // cursor we just saved, or picks up the fresh post-reset state.

        const done = exhausted || processed >= cap.maxThreads;

        const totalEstimate = totalEstimateFor(processed);

        if (!done) {
          const res = await db.providerSyncState.updateMany({
            where: { emailAccountId, backfillGeneration: claimedGeneration },
            data: {
              backfillStatus: "RUNNING",
              backfillStartedAt: null,
              backfillPageToken: pageToken ?? null,
              backfillProcessedCount: processed,
              backfillTotalEstimate: totalEstimate,
              backfillSkipped: baseSkipped + runSkipped,
            },
          });
          await backfillInboxQueue.add("backfill-inbox", { workspaceId });
          await job.updateProgress(100);
          // Notify SSE subscribers so the backfill card's processed count and
          // thread list update live, without a manual refresh.
          if (res.count > 0) {
            publishWorkspaceSynced(workspaceId).catch((err) => {
              console.error("[backfill-inbox] Failed to publish synced event:", err instanceof Error ? err.message : err);
            });
          }
          console.log(
            res.count === 0
              ? `[backfill-inbox] Workspace ${workspaceId}: superseded by a reset mid-run — handing off`
              : `[backfill-inbox] Workspace ${workspaceId}: processed ${processedThisRun} this run (${processed} total) — continuing`
          );
          return;
        }

        // ── 10. Final run: reconcile trash/spam/important, then mark DONE ───────
        //
        // The `after:` query excludes trash and spam by default, so threads that
        // moved there after first sync never appear in the page loop. Run targeted
        // queries once, on the final run, to correct their flags.

        const afterSecs = Math.floor(afterMs / 1000);

        const [trashIds, spamIds, importantIds] = await Promise.all([
          client.listThreadIdsByQuery(`in:trash after:${afterSecs}`, 500),
          client.listThreadIdsByQuery(`in:spam after:${afterSecs}`, 500),
          client.listThreadIdsByQuery("is:important", 2_000),
        ]);

        if (trashIds.length > 0) {
          await db.emailThread.updateMany({
            where: { emailAccountId, providerThreadId: { in: trashIds } },
            data: { gmailIsTrash: true },
          });
        }
        if (spamIds.length > 0) {
          await db.emailThread.updateMany({
            where: { emailAccountId, providerThreadId: { in: spamIds } },
            data: { gmailIsSpam: true },
          });
        }
        if (importantIds.length > 0) {
          await db.emailThread.updateMany({
            where: { emailAccountId, providerThreadId: { in: importantIds } },
            data: { gmailIsImportant: true },
          });
        }

        // Cap-reached when we stopped because the plan cap was hit while Gmail
        // still had more threads (not because the inbox was exhausted). The
        // beyond-cap count is approximate (Gmail's resultSizeEstimate).
        const capReached = !exhausted && processed >= cap.maxThreads;
        const beyondCount = capReached ? Math.max(0, resultSizeEstimate - processed) : 0;

        const doneRes = await db.providerSyncState.updateMany({
          where: { emailAccountId, backfillGeneration: claimedGeneration },
          data: {
            backfillStatus: "DONE",
            backfillStartedAt: null,
            backfillCompletedAt: new Date(),
            backfillPageToken: null,
            backfillProcessedCount: processed,
            // All threads loaded — the estimate now equals what we processed.
            backfillTotalEstimate: processed,
            backfillSkipped: baseSkipped + runSkipped,
            backfillCapReached: capReached,
            backfillBeyondCount: beyondCount,
            // Backfill finished — stop auto-routing arriving backlog. New live
            // threads still auto-route via the normal sync path.
            autoRouteBacklogArmed: false,
          },
        });

        await job.updateProgress(100);

        if (doneRes.count === 0) {
          // A reset (sweep) landed just as we finished — don't mark DONE over it;
          // hand off so the fresh scan runs.
          await backfillInboxQueue.add("backfill-inbox", { workspaceId });
          console.log(`[backfill-inbox] Workspace ${workspaceId}: superseded by a reset at completion — handing off`);
          return;
        }

        // Final notify so the card flips out of its RUNNING state and the
        // counts settle without a manual refresh.
        publishWorkspaceSynced(workspaceId).catch((err) => {
          console.error("[backfill-inbox] Failed to publish synced event:", err instanceof Error ? err.message : err);
        });

        console.log(
          `[backfill-inbox] Workspace ${workspaceId}: backfill complete — processed ${processed} threads, skipped ${baseSkipped + runSkipped}`
        );
      } catch (err) {
        // ── On failure: mark ERROR but keep the cursor so a retry resumes ──────
        // rather than restarting from the beginning of the inbox. Guarded on our
        // generation so a concurrent reset (sweep) is not overwritten.
        // Keep autoRouteBacklogArmed as-is: ERROR is resumable (the next sync
        // cycle re-enqueues backfill), so the resumed run should keep auto-routing
        // the arriving backlog. The arm is cleared only when backfill reaches DONE.
        // A never-completing backfill leaves the arm set, but that is benign:
        // enqueueArmedBacklog is a no-op once there is no never-attempted backlog.
        await db.providerSyncState.updateMany({
          where: { emailAccountId, backfillGeneration: claimedGeneration },
          data: { backfillStatus: "ERROR", backfillStartedAt: null },
        });
        throw err;
      }
    },
    {
      connection: redisConnection,
      // Only one backfill per process at a time — these are heavy jobs.
      concurrency: 1,
      // Each run processes up to BACKFILL_CHUNK_THREADS threads with per-thread
      // Gmail API calls, then re-enqueues, so a run is bounded but can still take
      // minutes. The lock auto-renews every lockDuration/2 ms while running, so
      // 10 minutes gives comfortable headroom.
      lockDuration: 600_000,
      // Allow recovery from a small number of stalls (e.g. dev restarts).
      maxStalledCount: 2,
    }
  );

  return worker;
}

// Export the queue reference for use in index.ts shutdown logic.
export { backfillInboxQueue };
