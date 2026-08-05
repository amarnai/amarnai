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
