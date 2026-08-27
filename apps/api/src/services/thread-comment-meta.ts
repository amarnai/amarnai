import { db } from "@amarnai/db";

// The comments badge numbers: total, and how many are unread for one member
// (newer than their ThreadCommentRead marker, authored by others). Shared by
// the internal-id meta route (web/extension collapsed section) and the
// provider-id meta route (the in-page bubble on the injected summary card), so
// "unread" can never mean two different things on two surfaces.
export async function loadThreadCommentsMeta(
  threadId: string,
  userId: string,
): Promise<{ total: number; unread: number }> {
  const read = await db.threadCommentRead.findUnique({
    where: { emailThreadId_userId: { emailThreadId: threadId, userId } },
    select: { lastReadAt: true },
  });

  const [total, unread] = await Promise.all([
    db.threadComment.count({ where: { emailThreadId: threadId } }),
    db.threadComment.count({
      where: {
        emailThreadId: threadId,
        authorUserId: { not: userId },
        ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
      },
    }),
  ]);

  return { total, unread };
}

// Batched variant for the thread list: one meta per thread id, computed in
// three bounded queries (totals, this member's read markers, and the
// others-authored comment timestamps for threads that have any comments)
// instead of two queries per row. Threads with no comments are omitted from
// the returned map — callers treat absence as {total: 0, unread: 0}.
export async function loadThreadCommentsMetaForThreads(
  threadIds: string[],
  userId: string,
): Promise<Map<string, { total: number; unread: number }>> {
  if (threadIds.length === 0) return new Map();

  const totals = await db.threadComment.groupBy({
    by: ["emailThreadId"],
    where: { emailThreadId: { in: threadIds } },
    _count: { _all: true },
  });
  const commentedIds = totals.map((t) => t.emailThreadId);
  if (commentedIds.length === 0) return new Map();

  // Unread = others' comments newer than this member's read marker. The
  // marker cutoff differs per thread, so fetch the (bounded: 200/thread cap)
  // timestamps and count in memory rather than one query per thread.
  const [reads, othersComments] = await Promise.all([
    db.threadCommentRead.findMany({
      where: { userId, emailThreadId: { in: commentedIds } },
      select: { emailThreadId: true, lastReadAt: true },
    }),
    db.threadComment.findMany({
      where: {
        emailThreadId: { in: commentedIds },
        authorUserId: { not: userId },
      },
      select: { emailThreadId: true, createdAt: true },
    }),
  ]);
  const lastReadByThread = new Map(reads.map((r) => [r.emailThreadId, r.lastReadAt]));

  const meta = new Map<string, { total: number; unread: number }>();
  for (const t of totals) {
    meta.set(t.emailThreadId, { total: t._count._all, unread: 0 });
  }
  for (const c of othersComments) {
    const lastReadAt = lastReadByThread.get(c.emailThreadId);
    if (lastReadAt && c.createdAt <= lastReadAt) continue;
    meta.get(c.emailThreadId)!.unread += 1;
  }
  return meta;
}
