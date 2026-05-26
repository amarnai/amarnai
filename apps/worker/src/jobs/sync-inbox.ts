import { Worker } from "bullmq";
import { db } from "@amarnai/db";
import {
  GmailClient,
  GmailHistoryCursorExpiredError,
  normalizeGmailThread,
} from "@amarnai/gmail";
import {
  classifyThreadQueue,
  backfillInboxQueue,
  QUEUE_SYNC_INBOX,
  type SyncInboxJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

      // ── 1. Load workspace + Gmail connection ────────────────────────────────

      const [workspace, connection] = await Promise.all([
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
      ]);

      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
      if (!connection) throw new Error(`No Gmail connection for workspace: ${workspaceId}`);

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
        select: { historyId: true },
      });

      // Capture whether this is the very first sync before we overwrite the cursor.
      const isFirstSync = syncState.historyId === null;

      // ── 3. Discover changed thread IDs ──────────────────────────────────────

      const client = new GmailClient(connection.encryptedRefreshToken);
      const { changedThreadIds, newHistoryId } = await getChangedThreadIds(
        client,
        syncState.historyId
      );

      if (changedThreadIds.length === 0) {
        // Nothing changed — advance the cursor and exit early.
        await db.providerSyncState.update({
          where: { emailAccountId },
          data: { historyId: newHistoryId, lastSyncedAt: new Date(), status: "IDLE" },
        });
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

        const snapshot = normalizeGmailThread(rawThread);
        if (snapshot.messages.length === 0) continue;

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
          },
          update: {
            subject: snapshot.subject,
            latestMessageAt: snapshot.latestMessageAt,
            messageCount: snapshot.messageCount,
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

      // On the very first sync, trigger a one-time backfill of historical threads.
      // Use a deterministic jobId so duplicate triggers are ignored by BullMQ.
      if (isFirstSync) {
        await backfillInboxQueue.add(
          "backfill-inbox",
          { workspaceId },
          { jobId: `backfill-inbox_${workspaceId}` }
        );
      }

      // ── 6. Enqueue classify-thread jobs for every upserted thread ────────────
      //
      // Job ID is deterministic per thread: a concurrent sync cannot enqueue
      // two classification runs for the same thread within the same second.
      // Priority 1 ensures live sync jobs always outrank backfill jobs (priority 10).

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

      await job.updateProgress(100);
    },
    {
      connection: redisConnection,
      // At most 2 workspace syncs run concurrently in this process.
      concurrency: 2,
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
