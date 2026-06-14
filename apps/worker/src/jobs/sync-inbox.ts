import { Worker } from "bullmq";
import { db } from "@amarnai/db";
import {
  GmailClient,
  GmailAuthError,
  GmailHistoryCursorExpiredError,
  normalizeGmailThread,
} from "@amarnai/gmail";
import type { GmailSyncSettings } from "@amarnai/shared";
import { isTaxonomyRoutable, isBackfillResumable } from "@amarnai/shared";
import {
  classifyThreadQueue,
  backfillInboxQueue,
  QUEUE_SYNC_INBOX,
  type SyncInboxJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import { publishWorkspaceSynced } from "../redis-publisher.js";
import { applyThreadFilter, computeThreadLabelFlags } from "./filter-thread-messages.js";

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
          select: { includeSpam: true, includePromotions: true, sortingPaused: true, blacklistedSenderEmails: true },
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
          select: { id: true, isRoot: true },
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
        select: { historyId: true, backfillStatus: true, backfillStartedAt: true, importantBackfilled: true },
      });

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
        // stuck-thread recovery still needs to run (they must not be skipped just
        // because the inbox was quiet this cycle).
        await db.providerSyncState.update({
          where: { emailAccountId },
          data: { historyId: newHistoryId, lastSyncedAt: new Date(), status: "IDLE" },
        });

        // Trigger backfill when it hasn't completed (or failed) yet, but only
        // if the workspace has enough taxonomy nodes to classify threads (≥ 3).
        // With fewer nodes the user needs to elaborate the taxonomy first.
        // Every plan backfills; per-plan thread/window limits are enforced by
        // the backfill job via getBackfillCap.
        // isBackfillResumable also recovers stale RUNNING state (worker crash).
        if (
          taxonomyStrong &&
          isBackfillResumable(syncState.backfillStatus, syncState.backfillStartedAt)
        ) {
          await backfillInboxQueue.add(
            "backfill-inbox",
            { workspaceId },
            { deduplication: { id: `backfill-inbox_${workspaceId}` } }
          );
        }

        // Re-enqueue stuck PENDING threads whose classify jobs exhausted all retries.
        // This covers both live-sync and backfill failures. Recovery runs on every
        // quiet cycle regardless of plan or backfill status, so threads are never
        // left permanently stuck.
        if (!sortingPaused) {
          const stuck = await db.emailThread.findMany({
            where: {
              workspaceId,
              triageStatus: "PENDING",
              classifyingAt: null,
            },
            select: { id: true },
            orderBy: { latestMessageAt: "desc" },
            take: 50,
          });

          if (stuck.length > 0) {
            await db.emailThread.updateMany({
              where: { id: { in: stuck.map((s) => s.id) } },
              data: { classifyingAt: new Date() },
            });
            await classifyThreadQueue.addBulk(
              stuck.map(({ id: emailThreadId }) => ({
                name: "classify-thread",
                data: { workspaceId, emailThreadId },
                opts: {
                  deduplication: { id: `classify_${workspaceId}_${emailThreadId}` },
                  priority: 5, // below live sync (1), above backfill (10)
                },
              }))
            );
          }
        }

        return;
      }

      await job.updateProgress(10);

      // ── 4. Fetch, normalize, and upsert each changed thread ─────────────────

      const upsertedEmailThreadIds: string[] = [];

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
            },
            update: {
              senderName: msg.senderName,
              snippet,
              hasAttachments: msg.attachments.length > 0,
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
      }

      await job.updateProgress(80);

      // ── 5. Enqueue classify-thread jobs for every upserted thread ────────────
      //
      // Priority 1 ensures live sync jobs always outrank backfill jobs (priority 10).
      // Stamp classifyingAt before adding to the queue so isClassifying is true
      // while jobs wait — without this the banner shows "use the sort button".
      // Skip enqueuing when sorting is paused; threads remain PENDING and will be
      // picked up by the stuck-thread recovery when the user resumes sorting.
      //
      // IMPORTANT: classify enqueue runs BEFORE the cursor is advanced (step 6).
      // If addBulk fails, the job throws and BullMQ retries with the old historyId,
      // so the same changed thread IDs are re-discovered and classification is
      // re-attempted. Advancing the cursor first would lose these threads
      // permanently if addBulk then failed.

      if (upsertedEmailThreadIds.length > 0) {
        if (!sortingPaused && taxonomyStrong) {
          await db.emailThread.updateMany({
            where: { id: { in: upsertedEmailThreadIds } },
            data: { classifyingAt: new Date() },
          });

          await classifyThreadQueue.addBulk(
            upsertedEmailThreadIds.map((emailThreadId) => ({
              name: "classify-thread",
              data: { workspaceId, emailThreadId },
              opts: {
                jobId: `classify_${workspaceId}_${emailThreadId}_${Date.now()}`,
                priority: 1,
              },
            }))
          );
        } else if (!taxonomyStrong) {
          await db.emailThread.updateMany({
            where: { id: { in: upsertedEmailThreadIds } },
            data: { triageStatus: "UNROUTED" },
          });
        }
        // sortingPaused && taxonomyStrong → leave PENDING (existing behaviour)
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

      // Trigger a historical backfill whenever it hasn't completed yet, but only
      // if the workspace has enough taxonomy nodes to classify threads (≥ 3).
      // Every plan backfills; per-plan thread/window limits are enforced by the
      // backfill job via getBackfillCap.
      // isBackfillResumable also recovers stale RUNNING state (worker crash).
      if (
        taxonomyStrong &&
        isBackfillResumable(syncState.backfillStatus, syncState.backfillStartedAt)
      ) {
        await backfillInboxQueue.add(
          "backfill-inbox",
          { workspaceId },
          { deduplication: { id: `backfill-inbox_${workspaceId}` } }
        );
      }

      // ── 7. Re-enqueue classify jobs for threads still PENDING after this cycle ──
      //
      // Covers threads whose classify jobs exhausted all retries (e.g. Ollama was
      // unreachable, AI provider down). Also catches threads whose classifyingAt was
      // stamped but addBulk failed in a previous cycle. Runs on every sync cycle
      // regardless of plan or backfill status, so threads are never left permanently
      // stuck. Deduplication prevents duplicate queue entries.

      if (!sortingPaused) {
        const stuck = await db.emailThread.findMany({
          where: {
            workspaceId,
            triageStatus: "PENDING",
            classifyingAt: null,
            id: { notIn: upsertedEmailThreadIds },
          },
          select: { id: true },
          orderBy: { latestMessageAt: "desc" },
          take: 50,
        });

        if (stuck.length > 0) {
          await db.emailThread.updateMany({
            where: { id: { in: stuck.map((s) => s.id) } },
            data: { classifyingAt: new Date() },
          });
          await classifyThreadQueue.addBulk(
            stuck.map(({ id: emailThreadId }) => ({
              name: "classify-thread",
              data: { workspaceId, emailThreadId },
              opts: {
                deduplication: { id: `classify_${workspaceId}_${emailThreadId}` },
                priority: 5, // below live sync (1), above backfill (10)
              },
            }))
          );
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
