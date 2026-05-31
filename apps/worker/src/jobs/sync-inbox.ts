import { Worker } from "bullmq";
import { db } from "@amarnai/db";
import {
  GmailClient,
  GmailHistoryCursorExpiredError,
  normalizeGmailThread,
} from "@amarnai/gmail";
import type { GmailSyncSettings } from "@amarnai/shared";
import {
  classifyThreadQueue,
  backfillInboxQueue,
  QUEUE_SYNC_INBOX,
  type SyncInboxJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
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
  encryptedRefreshToken: string
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
      // The worker holds a reference to the encrypted token through GmailClient;
      // we store a placeholder here because the worker never issues access tokens
      // directly — GmailClient handles token refresh from the refresh token.
      accessTokenEncrypted: "placeholder",
      refreshTokenEncrypted: encryptedRefreshToken,
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
          select: { ownerUserId: true, plan: true },
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

      // ── 2. Ensure EmailAccount + ProviderSyncState rows exist ───────────────

      const emailAccountId = await ensureEmailAccount(
        workspaceId,
        workspace.ownerUserId,
        connection.gmailAddress,
        connection.googleSubjectId,
        connection.encryptedRefreshToken
      );

      const syncState = await db.providerSyncState.upsert({
        where: { emailAccountId },
        create: { emailAccountId, provider: "GMAIL" },
        update: { status: "SYNCING", errorMessage: null },
        select: { historyId: true, backfillStatus: true },
      });

      // ── 3. Discover changed thread IDs ──────────────────────────────────────

      const client = new GmailClient(connection.encryptedRefreshToken);
      const { changedThreadIds, newHistoryId } = await getChangedThreadIds(
        client,
        syncState.historyId
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
        // Backfill is a paying-plan-only feature.
        if (
          workspace.plan !== "FREE" &&
          (syncState.backfillStatus === "PENDING" || syncState.backfillStatus === "ERROR")
        ) {
          const nodeCount = await db.taxonomyNode.count({ where: { workspaceId } });
          if (nodeCount > 3) {
            await backfillInboxQueue.add(
              "backfill-inbox",
              { workspaceId },
              { deduplication: { id: `backfill-inbox_${workspaceId}` } }
            );
          }
        }

        // Re-enqueue stuck PENDING threads when the backfill has already finished
        // but some classify jobs exhausted all retries.
        if (syncState.backfillStatus === "DONE" && !sortingPaused) {
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

      // ── 5. Advance sync cursor ───────────────────────────────────────────────

      await db.providerSyncState.update({
        where: { emailAccountId },
        data: {
          historyId: newHistoryId,
          lastSyncedAt: new Date(),
          status: "IDLE",
          errorMessage: null,
        },
      });

      // Trigger a historical backfill whenever it hasn't completed yet, but only
      // if the workspace has enough taxonomy nodes to classify threads (≥ 3).
      // Backfill is a paying-plan-only feature.
      if (
        workspace.plan !== "FREE" &&
        (syncState.backfillStatus === "PENDING" || syncState.backfillStatus === "ERROR")
      ) {
        const nodeCount = await db.taxonomyNode.count({ where: { workspaceId } });
        if (nodeCount >= 3) {
          await backfillInboxQueue.add(
            "backfill-inbox",
            { workspaceId },
            { deduplication: { id: `backfill-inbox_${workspaceId}` } }
          );
        }
      }

      // ── 6. Enqueue classify-thread jobs for every upserted thread ────────────
      //
      // Priority 1 ensures live sync jobs always outrank backfill jobs (priority 10).
      // Stamp classifyingAt before adding to the queue so isClassifying is true
      // while jobs wait — without this the banner shows "use the sort button".
      // Skip enqueuing when sorting is paused; threads remain PENDING and will be
      // picked up when the user resumes sorting.

      if (upsertedEmailThreadIds.length > 0 && !sortingPaused) {
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
      }

      // ── 7. Re-enqueue classify jobs for threads still PENDING after backfill ──
      //
      // Covers threads whose classify jobs exhausted all retries (e.g. Ollama was
      // unreachable during the backfill run). The backfill marks DONE once it has
      // enqueued jobs, not once they succeed, so permanently-failed jobs leave
      // threads stuck as PENDING with no automatic recovery. This runs on every
      // sync cycle as a lightweight catch-up: it skips threads already being
      // classified (classifyingAt set) and threads changed in this sync cycle
      // (already handled above). Deduplication prevents duplicate queue entries.

      if (syncState.backfillStatus === "DONE" && !sortingPaused) {
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
  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { workspaceId } = job.data;
    try {
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
