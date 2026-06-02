import { Worker } from "bullmq";
import { db } from "@amarnai/db";
import { GmailClient, GmailThreadMeta, normalizeGmailThread } from "@amarnai/gmail";
import type { GmailSyncSettings } from "@amarnai/shared";
import {
  classifyThreadQueue,
  backfillInboxQueue,
  QUEUE_BACKFILL_INBOX,
  type BackfillInboxJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import {
  applyThreadFilter,
  computeThreadLabelFlags,
  computeThreadLabelFlagsFromMeta,
  isThreadExcluded,
} from "./filter-thread-messages.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKFILL_WINDOW_DAYS = 90;
const BACKFILL_MAX_THREADS = 1_000;

/** BullMQ priority for backfill classify jobs — higher number = lower priority. */
const BACKFILL_CLASSIFY_PRIORITY = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sort threads: unread first, then by latestMessageAt descending. */
function sortByPriority(threads: GmailThreadMeta[]): GmailThreadMeta[] {
  return [...threads].sort((a, b) => {
    // Unread threads come first.
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    // Within same unread status, newest first.
    return b.latestMessageAt.getTime() - a.latestMessageAt.getTime();
  });
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
          select: { ownerUserId: true },
        }),
        db.gmailConnection.findUnique({
          where: { workspaceId },
          select: {
            gmailAddress: true,
            googleSubjectId: true,
            encryptedRefreshToken: true,
          },
        }),
        db.gmailSyncSettings.findUnique({
          where: { workspaceId },
          select: { includeSpam: true, includePromotions: true, sortingPaused: true, blacklistedSenderEmails: true },
        }),
      ]);

      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
      if (!connection) throw new Error(`No Gmail connection for workspace: ${workspaceId}`);

      const settings: GmailSyncSettings = {
        includeSpam:             syncSettingsRow?.includeSpam             ?? false,
        includePromotions:       syncSettingsRow?.includePromotions       ?? false,
        sortingPaused:           syncSettingsRow?.sortingPaused           ?? false,
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

      const syncState = await db.providerSyncState.findUnique({
        where: { emailAccountId },
        select: { backfillStatus: true },
      });

      // ── 3. Guard: skip if already completed or currently running ────────────

      if (syncState?.backfillStatus === "DONE" || syncState?.backfillStatus === "RUNNING") {
        console.log(
          `[backfill-inbox] Workspace ${workspaceId} already ${syncState.backfillStatus} — skipping`
        );
        return;
      }

      // ── 4. Mark as RUNNING ──────────────────────────────────────────────────

      await db.providerSyncState.update({
        where: { emailAccountId },
        data: { backfillStatus: "RUNNING" },
      });

      await job.updateProgress(5);

      try {
        // ── 5. Fetch threads in the 90-day window (capped at 1,000) ────────────

        const client = new GmailClient(connection.encryptedRefreshToken);
        const nowMs = Date.now();
        const afterMs = nowMs - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

        const { threads: rawThreads, totalFound } = await client.listThreadsInWindow({
          afterMs,
          maxResults: BACKFILL_MAX_THREADS,
        });

        await job.updateProgress(20);

        // ── 6. Sort: unread first, then by recency ──────────────────────────────

        const sortedThreads = sortByPriority(rawThreads);

        // ── 7. Upsert threads + messages; skip those already in the DB ──────────
        //
        // We only upsert threads that are NOT already present as EmailThread rows
        // for this account (i.e., not already picked up by a live sync). For those
        // that are already present we still want to classify them, so we track all
        // thread IDs.

        const upsertedEmailThreadIds: string[] = [];
        const total = sortedThreads.length;

        for (let i = 0; i < total; i++) {
          const gmailThread = sortedThreads[i]!;

          // Check if thread already exists in DB for this account.
          const existing = await db.emailThread.findUnique({
            where: {
              emailAccountId_providerThreadId: {
                emailAccountId,
                providerThreadId: gmailThread.id,
              },
            },
            select: { id: true, triageStatus: true },
          });

          if (existing) {
            // Compute label flags from metadata (no extra network call needed).
            const flagsFromMeta = computeThreadLabelFlagsFromMeta(gmailThread.messageLabelIds);

            // Always update stored flags so query-time filtering reflects current Gmail state.
            await db.emailThread.update({
              where: { id: existing.id },
              data: flagsFromMeta,
            });

            // Skip classification if excluded; only re-classify PENDING threads.
            const excluded = isThreadExcluded(flagsFromMeta, settings);
            if (!excluded && existing.triageStatus === "PENDING") {
              upsertedEmailThreadIds.push(existing.id);
            }
            continue;
          }

          // ── New thread: fetch full data, compute flags, apply filter ────────

          let rawFull: unknown;
          try {
            rawFull = await client.getThread(gmailThread.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("not found")) continue;
            throw err;
          }

          const rawSnapshot = normalizeGmailThread(rawFull);
          const labelFlags = computeThreadLabelFlags(rawSnapshot.messages);
          const snapshot = applyThreadFilter(rawSnapshot, settings);

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
              },
              update: {
                senderName: msg.senderName,
                snippet,
                hasAttachments: msg.attachments.length > 0,
              },
              select: { id: true },
            });
          }

          upsertedEmailThreadIds.push(emailThread.id);

          // Report progress periodically.
          if (i % 50 === 0) {
            await job.updateProgress(20 + Math.floor((i / total) * 60));
          }
        }

        await job.updateProgress(80);

        // ── 8. Cleanup pass: mark threads that moved to trash/spam ───────────
        //
        // listThreadsInWindow uses a plain `after:` query which Gmail excludes
        // trash and spam from by default.  Threads that were in the inbox when
        // first synced and later moved to trash/spam never appear in the main
        // loop above, so their gmailIsTrash / gmailIsSpam flags are never
        // updated and they remain visible.  Here we do a targeted query for
        // each excluded area and bulk-update any matching DB rows.

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

        // ── 10. Enqueue classify-thread jobs at backfill priority ───────────
        //
        // Use deduplication rather than a fixed jobId so that a previously-failed
        // classify job for this thread doesn't block re-enqueuing — deduplication
        // keys are cleared after the job completes or fails, unlike jobId which
        // persists in the failed set until explicitly removed.
        //
        // Stamp classifyingAt before adding to the queue so that isClassifying
        // is true while jobs wait — without this, threads look unsorted to the
        // banner even though they are in the queue.
        //
        // Skip enqueuing when sorting is paused; threads remain PENDING and will
        // be picked up when the user resumes sorting.

        if (!sortingPaused && upsertedEmailThreadIds.length > 0) {
          const enqueuedAt = new Date();
          await db.emailThread.updateMany({
            where: { id: { in: upsertedEmailThreadIds } },
            data: { classifyingAt: enqueuedAt },
          });

          await classifyThreadQueue.addBulk(
            upsertedEmailThreadIds.map((emailThreadId) => ({
              name: "classify-thread",
              data: { workspaceId, emailThreadId },
              opts: {
                deduplication: { id: `classify_backfill_${workspaceId}_${emailThreadId}` },
                priority: BACKFILL_CLASSIFY_PRIORITY,
              },
            }))
          );
        }

        await job.updateProgress(95);

        // ── 11. Mark DONE and record skipped count ───────────────────────────

        const backfillSkipped = Math.max(0, totalFound - rawThreads.length);
        await db.providerSyncState.update({
          where: { emailAccountId },
          data: {
            backfillStatus: "DONE",
            backfillCompletedAt: new Date(),
            backfillSkipped,
          },
        });

        await job.updateProgress(100);

        console.log(
          `[backfill-inbox] Workspace ${workspaceId}: classified ${upsertedEmailThreadIds.length} threads, skipped ${backfillSkipped}`
        );
      } catch (err) {
        // ── On failure: mark ERROR so the UI can show a retry signal ─────────
        await db.providerSyncState.update({
          where: { emailAccountId },
          data: { backfillStatus: "ERROR" },
        });
        throw err;
      }
    },
    {
      connection: redisConnection,
      // Only one backfill per process at a time — these are heavy jobs.
      concurrency: 1,
      // Backfill iterates up to 1 000 threads with per-thread Gmail API calls;
      // the job can run for many minutes.  The lock auto-renews every
      // lockDuration/2 ms while running, so 10 minutes gives comfortable headroom.
      lockDuration: 600_000,
      // Allow recovery from a small number of stalls (e.g. dev restarts).
      maxStalledCount: 2,
    }
  );

  return worker;
}

// Export the queue reference for use in index.ts shutdown logic.
export { backfillInboxQueue };
