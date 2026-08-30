import { Worker, UnrecoverableError } from "bullmq";
import { db, markGmailConnectionAuthFailed } from "@aziru/db";
import {
  createMailProvider,
  MailAuthError,
  MailThreadNotFoundError,
  MailInvalidLabelError,
} from "@aziru/mail";
import {
  QUEUE_WRITEBACK_THREAD_LABEL,
  type WritebackThreadLabelJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import { pushNotificationQueue } from "../queues.js";
import { loadWritebackConnection, provisionFolderLabels } from "./provision-folder-labels.js";

/**
 * writeback-thread-label worker: after a classification write, reconcile the
 * Aziru-managed label/category on one thread to its current folder.
 *
 * Declarative and idempotent: the job carries no node id — it re-reads the
 * thread's LATEST EmailClassification (append-only table) so retries and
 * deduped duplicates always converge on the newest human/AI decision, and the
 * adapter no-ops when the thread already matches. A thread at the taxonomy root
 * (or with no classification) resolves to "no managed label".
 *
 * Known micro-race: a move landing while this job is in flight may coalesce away
 * its enqueue (shared dedup id); the next classification self-heals, and the
 * declarative reconcile makes any retry safe.
 */
export function createWritebackThreadLabelWorker(): Worker<WritebackThreadLabelJobData> {
  return new Worker<WritebackThreadLabelJobData>(
    QUEUE_WRITEBACK_THREAD_LABEL,
    async (job) => {
      const { workspaceId, emailThreadId } = job.data;

      const connection = await loadWritebackConnection(workspaceId);
      if (!connection) return; // flag off / disabled / no scope — silent no-op

      const thread = await db.emailThread.findFirst({
        where: { id: emailThreadId, workspaceId },
        select: { providerThreadId: true },
      });
      // A missing thread will never appear — do not retry.
      if (!thread) throw new UnrecoverableError(`EmailThread not found: ${emailThreadId}`);

      const [messages, latest, links] = await Promise.all([
        db.emailMessage.findMany({
          where: { emailThreadId, workspaceId },
          select: { providerMessageId: true },
        }),
        db.emailClassification.findFirst({
          where: { emailThreadId, workspaceId },
          orderBy: { createdAt: "desc" },
          select: { finalNodeId: true },
        }),
        db.taxonomyNodeProviderLink.findMany({
          where: { workspaceId, provider: connection.provider, mailboxKey: connection.mailboxKey },
          select: { nodeId: true, providerLabelId: true },
        }),
      ]);

      const managedLabelIds = links.map((l) => l.providerLabelId);
      const labelByNode = new Map(links.map((l) => [l.nodeId, l.providerLabelId]));

      // The single label this thread should carry, if any. Root/unclassified and
      // no-classification both resolve to "remove all managed labels".
      let desiredLabelIds: string[] = [];
      const finalNodeId = latest?.finalNodeId ?? null;
      if (finalNodeId) {
        let labelId = labelByNode.get(finalNodeId);
        if (!labelId) {
          // A folder created after enablement has no link yet — provision now,
          // then re-read. (Root nodes never get a link, so this stays empty.)
          try {
            await provisionFolderLabels(workspaceId, connection);
          } catch (err) {
            if (!(err instanceof MailAuthError)) throw err;
            await handleAuthFailure(workspaceId, err);
            return;
          }
          const link = await db.taxonomyNodeProviderLink.findUnique({
            where: { nodeId_provider: { nodeId: finalNodeId, provider: connection.provider } },
            select: { providerLabelId: true, mailboxKey: true },
          });
          if (link && link.mailboxKey === connection.mailboxKey) {
            labelId = link.providerLabelId;
            managedLabelIds.push(labelId);
          }
        }
        if (labelId) desiredLabelIds = [labelId];
      }

      try {
        await createMailProvider(connection).applyThreadFolderLabels({
          threadId: thread.providerThreadId,
          messageIds: messages.map((m) => m.providerMessageId),
          desiredLabelIds,
          managedLabelIds,
        });
      } catch (err) {
        if (err instanceof MailThreadNotFoundError) {
          console.log(`[writeback-thread-label] thread ${emailThreadId} gone provider-side — skipping`);
          return;
        }
        if (err instanceof MailInvalidLabelError) {
          // A managed label was deleted provider-side, so our stored id is
          // stale and this request can never succeed as-is. Re-provision (the
          // provider is re-listed, the label recreated, the link refreshed),
          // then rethrow so the BullMQ retry re-reads the fresh link and applies.
          console.warn(
            `[writeback-thread-label] stale label id for thread ${emailThreadId} — re-provisioning: ${err.message}`,
          );
          try {
            await provisionFolderLabels(workspaceId, connection);
          } catch (provErr) {
            if (provErr instanceof MailAuthError) {
              await handleAuthFailure(workspaceId, provErr);
              return;
            }
            throw provErr;
          }
          throw err;
        }
        if (err instanceof MailAuthError) {
          await handleAuthFailure(workspaceId, err);
          return;
        }
        throw err; // transient — let BullMQ retry
      }
    },
    { connection: redisConnection },
  );
}

/** Flip the connection to DISCONNECTED on a dead token and nudge once. */
async function handleAuthFailure(workspaceId: string, err: MailAuthError): Promise<void> {
  console.error(
    `[writeback-thread-label] auth failed for workspace ${workspaceId} — marking DISCONNECTED: ${err.message}`,
  );
  const flipped = await markGmailConnectionAuthFailed(workspaceId).catch(() => false);
  if (flipped) {
    await pushNotificationQueue
      .add("push-notification", { kind: "gmail_disconnected", workspaceId })
      .catch(() => {});
  }
}
