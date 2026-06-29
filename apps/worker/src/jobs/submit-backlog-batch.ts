/**
 * Embed-batch the workspace's waiting backlog ("Route now" in batch mode).
 *
 * On the first pass it CLAIMS the entire eligible backlog (PENDING/UNROUTED →
 * BATCH_PENDING) in one update, so the "Route now" banner's waiting count drops
 * to zero immediately and the threads render as "Sorting…" while their batches
 * are still being assembled. It then embed-batches the claimed-but-not-yet-
 * batched threads a chunk at a time (re-fetching bodies, since these threads
 * already exist in the DB), reporting whether more remain so the caller can
 * re-enqueue. A thread that can't be fetched falls back to the online path so it
 * is never stuck "Sorting…" forever.
 */
import { db } from "@amarnai/db";
import { buildThreadEmbeddingText, snapshotToThreadMessages } from "@amarnai/ai";
import { GmailClient, GmailAuthError, normalizeGmailThread } from "@amarnai/gmail";
import { submitEmbedBatch, type EmbedBatchThread } from "./submit-embed-batch.js";
import { loadRoutableTaxonomy, fallbackThreadsToOnline } from "./batch-routing-helpers.js";

const BACKLOG_BATCH_CHUNK = 200;

export async function submitBacklogBatch(
  workspaceId: string,
): Promise<{ submitted: number; remaining: boolean }> {
  const tag = `[route-backlog] ws=${workspaceId}`;

  // Taxonomy must be routable, else the backlog stays PENDING (the user still
  // needs to build a plan — the banner reflects that).
  const tax = await loadRoutableTaxonomy(workspaceId);
  if (!tax) {
    console.log(`${tag} taxonomy not routable — leaving backlog PENDING`);
    return { submitted: 0, remaining: false };
  }

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { encryptedRefreshToken: true, status: true, googleSubjectId: true, gmailAddress: true },
  });
  if (!connection || connection.status !== "ACTIVE") {
    console.warn(`${tag} no active Gmail connection — skipping`);
    return { submitted: 0, remaining: false };
  }

  const providerAccountId = connection.googleSubjectId ?? connection.gmailAddress;
  const emailAccount = await db.emailAccount.findUnique({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    select: { id: true },
  });
  if (!emailAccount) {
    console.warn(`${tag} no EmailAccount — skipping`);
    return { submitted: 0, remaining: false };
  }

  // 1. CLAIM the whole waiting backlog up front: PENDING/UNROUTED (never-attempted,
  //    not in flight, not trash) → BATCH_PENDING. This removes them from the
  //    "ready to route" count immediately (banner stays hidden) and makes them
  //    render as "Sorting…" while their batch is assembled. Idempotent.
  const claimed = await db.emailThread.updateMany({
    where: {
      workspaceId,
      triageStatus: { in: ["PENDING", "UNROUTED"] },
      classifyingAt: null,
      classifyFailedAt: null,
      gmailIsTrash: false,
    },
    data: { triageStatus: "BATCH_PENDING" },
  });
  if (claimed.count > 0) console.log(`${tag} claimed ${claimed.count} backlog thread(s) → BATCH_PENDING`);

  // 2. Select a chunk of claimed threads that don't yet have a batch row.
  const pending = await db.emailThread.findMany({
    where: { workspaceId, triageStatus: "BATCH_PENDING", batchThreadState: { is: null } },
    select: { id: true, providerThreadId: true },
    orderBy: { latestMessageAt: "desc" },
    take: BACKLOG_BATCH_CHUNK + 1,
  });
  if (pending.length === 0) {
    console.log(`${tag} no un-batched backlog threads remain`);
    return { submitted: 0, remaining: false };
  }
  const remaining = pending.length > BACKLOG_BATCH_CHUNK;
  const slice = pending.slice(0, BACKLOG_BATCH_CHUNK);

  // 3. Re-fetch bodies + build embed text. A thread we cannot fetch falls back to
  //    the online path so it never stays stuck BATCH_PENDING with no batch.
  const client = new GmailClient(connection.encryptedRefreshToken);
  const threads: EmbedBatchThread[] = [];
  const unfetchable: string[] = [];
  for (const t of slice) {
    try {
      const raw = await client.getThread(t.providerThreadId);
      const snapshot = normalizeGmailThread(raw);
      if (snapshot.messages.length === 0) {
        unfetchable.push(t.id);
        continue;
      }
      const tmsgs = snapshotToThreadMessages(snapshot);
      const embedText = buildThreadEmbeddingText(
        tmsgs.map((m) => ({
          subject: m.subject,
          bodyText: m.bodyText,
          ...(m.attachmentNames?.length ? { attachmentNames: m.attachmentNames } : {}),
        })),
      );
      threads.push({ emailThreadId: t.id, embedText, messageCount: snapshot.messageCount });
    } catch (err) {
      if (err instanceof GmailAuthError) throw err; // surface auth failures
      console.warn(
        `${tag} thread ${t.id} fetch failed (${err instanceof Error ? err.message : String(err)}) — online fallback`,
      );
      unfetchable.push(t.id);
    }
  }

  if (unfetchable.length > 0) await fallbackThreadsToOnline(workspaceId, unfetchable);

  if (threads.length > 0) {
    console.log(`${tag} embed-batching ${threads.length} backlog thread(s)${remaining ? " (more remain)" : ""}`);
    await submitEmbedBatch({ workspaceId, emailAccountId: emailAccount.id, threads, now: new Date() });
  }
  return { submitted: threads.length, remaining };
}
