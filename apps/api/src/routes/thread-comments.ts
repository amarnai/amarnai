import { Hono } from "hono";
import { z } from "zod";
import {
  db,
  createNotification,
  deleteCommentMentionNotifications,
} from "@aziru/db";
import {
  CreateThreadCommentSchema,
  MAX_COMMENTS_PER_THREAD,
} from "@aziru/shared";
import type { AppEnv } from "../env.js";
import { recordAudit } from "../services/audit.js";
import { loadThreadCommentsMeta } from "../services/thread-comment-meta.js";
import { throttleOnce } from "../services/rate-limit.js";
import { pushNotificationQueue } from "../queues.js";

// Thread comments: team discussion on a thread. Membership is enforced by the
// requireWorkspaceMember wildcard on /workspaces/:workspaceId/*; the actor is
// always c.get("userId"), never read from the body. Comment bodies are
// user-generated and may quote email content, so they are never logged and never
// placed in audit metadata or notification params.

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

// One create per this many seconds per user — roughly 10 comments/minute, which
// doubles as mention-notification spam protection.
const CREATE_THROTTLE_SECONDS = 6;

type CommentAuthorRow = { id: string; name: string | null; email: string };

function serializeComment(comment: {
  id: string;
  body: string;
  mentionUserIds: string[];
  createdAt: Date;
  author: CommentAuthorRow;
}) {
  return {
    id: comment.id,
    body: comment.body,
    mentionUserIds: comment.mentionUserIds,
    author: {
      userId: comment.author.id,
      name: comment.author.name,
      email: comment.author.email,
    },
    createdAt: comment.createdAt.toISOString(),
  };
}

async function findThread(workspaceId: string, threadId: string) {
  return db.emailThread.findFirst({
    where: { id: threadId, workspaceId },
    select: { id: true, subject: true },
  });
}

const threadComments = new Hono<AppEnv>();

// ─── GET /workspaces/:workspaceId/email-threads/:threadId/comments ─────────────
//
// Full list, oldest first, plus the caller's read marker so the client can
// derive the unread badge locally. The per-thread cap (MAX_COMMENTS_PER_THREAD)
// keeps the whole list small enough that pagination is unnecessary.

threadComments.get(
  "/workspaces/:workspaceId/email-threads/:threadId/comments",
  async (c) => {
    const parsedParams = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsedParams.success) return c.json({ error: "Invalid params" }, 400);
    const { workspaceId, threadId } = parsedParams.data;
    const userId = c.get("userId");

    const thread = await findThread(workspaceId, threadId);
    if (!thread) return c.json({ error: "Thread not found" }, 404);

    const [comments, read] = await Promise.all([
      db.threadComment.findMany({
        where: { emailThreadId: threadId },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true, email: true } } },
      }),
      db.threadCommentRead.findUnique({
        where: { emailThreadId_userId: { emailThreadId: threadId, userId } },
        select: { lastReadAt: true },
      }),
    ]);

    return c.json({
      comments: comments.map(serializeComment),
      lastReadAt: read?.lastReadAt.toISOString() ?? null,
    });
  },
);

// ─── GET /workspaces/:workspaceId/email-threads/:threadId/comments/meta ────────
//
// Lightweight counts for a collapsed comments section: total, and how many are
// unread for the caller (newer than their read marker, authored by others). Lets
// the injected panel show its badge without loading the list.

threadComments.get(
  "/workspaces/:workspaceId/email-threads/:threadId/comments/meta",
  async (c) => {
    const parsedParams = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsedParams.success) return c.json({ error: "Invalid params" }, 400);
    const { workspaceId, threadId } = parsedParams.data;
    const userId = c.get("userId");

    const thread = await findThread(workspaceId, threadId);
    if (!thread) return c.json({ error: "Thread not found" }, 404);

    return c.json(await loadThreadCommentsMeta(threadId, userId));
  },
);

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/comments/read ───────
//
// Upsert the caller's read marker to now. Fired when the comment section is
// opened; idempotent, not audited.

threadComments.post(
  "/workspaces/:workspaceId/email-threads/:threadId/comments/read",
  async (c) => {
    const parsedParams = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsedParams.success) return c.json({ error: "Invalid params" }, 400);
    const { workspaceId, threadId } = parsedParams.data;
    const userId = c.get("userId");

    const thread = await findThread(workspaceId, threadId);
    if (!thread) return c.json({ error: "Thread not found" }, 404);

    const now = new Date();
    await db.threadCommentRead.upsert({
      where: { emailThreadId_userId: { emailThreadId: threadId, userId } },
      create: { workspaceId, emailThreadId: threadId, userId, lastReadAt: now },
      update: { lastReadAt: now },
    });

    return c.json({ ok: true, lastReadAt: now.toISOString() });
  },
);

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/comments ────────────
//
// Create a comment. Mentions arrive as structured user ids (the body is never
// parsed server-side): each is re-validated against workspace membership so a
// member cannot mint notifications to arbitrary user ids. Notification
// production is best-effort and never fails the create.

threadComments.post(
  "/workspaces/:workspaceId/email-threads/:threadId/comments",
  async (c) => {
    const parsedParams = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsedParams.success) return c.json({ error: "Invalid params" }, 400);
    const { workspaceId, threadId } = parsedParams.data;
    const userId = c.get("userId");

    const thread = await findThread(workspaceId, threadId);
    if (!thread) return c.json({ error: "Thread not found" }, 404);

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid body" }, 400);
    }
    const parsedBody = CreateThreadCommentSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json({ error: "Invalid body", details: parsedBody.error.issues }, 400);
    }
    const { body, mentionUserIds } = parsedBody.data;

    const allowed = await throttleOnce(
      `comment-create:${userId}`,
      CREATE_THROTTLE_SECONDS,
    );
    if (!allowed) {
      return c.json({ error: "You are commenting too fast. Try again shortly." }, 429);
    }

    const existing = await db.threadComment.count({
      where: { emailThreadId: threadId },
    });
    if (existing >= MAX_COMMENTS_PER_THREAD) {
      return c.json({ error: "Comment limit reached for this thread" }, 409);
    }

    // Every mentioned id must be a member of THIS workspace.
    const mentions = [...new Set(mentionUserIds)];
    if (mentions.length > 0) {
      const memberRows = await db.workspaceMember.findMany({
        where: { workspaceId, userId: { in: mentions } },
        select: { userId: true },
      });
      if (memberRows.length !== mentions.length) {
        return c.json({ error: "Mentioned user is not a member of this workspace" }, 400);
      }
    }

    const comment = await db.threadComment.create({
      data: {
        workspaceId,
        emailThreadId: threadId,
        authorUserId: userId,
        body,
        mentionUserIds: mentions,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    await recordAudit({
      workspaceId,
      actorType: "USER",
      actorUserId: userId,
      eventType: "comment.created",
      entityType: "ThreadComment",
      entityId: comment.id,
      metadata: { threadId, mentionCount: mentions.length },
    });

    // Notify mentioned members — but never the author mentioning themselves.
    // Both the in-app notification and the push are best-effort and must not
    // fail the create. Params carry the thread subject (thread_assigned
    // precedent), never the comment body.
    const recipients = mentions.filter((id) => id !== userId);
    if (recipients.length > 0) {
      for (const mentionedUserId of recipients) {
        try {
          await createNotification({
            userId: mentionedUserId,
            workspaceId,
            type: "comment_mention",
            params: {
              threadId,
              subject: thread.subject ?? null,
              commentId: comment.id,
              mentionedByUserId: userId,
              mentionedByName: comment.author.name,
              mentionedByEmail: comment.author.email,
            },
          });
        } catch (err) {
          console.error(
            "[thread-comments] Failed to create mention notification:",
            err instanceof Error ? err.message : err,
          );
        }
        try {
          await pushNotificationQueue.add("comment_mention", {
            kind: "comment_mention",
            workspaceId,
            emailThreadId: threadId,
            commentId: comment.id,
            mentionedUserId,
            mentionedByUserId: userId,
          });
        } catch (err) {
          console.error(
            "[thread-comments] Failed to enqueue push:",
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    return c.json({ ok: true, comment: serializeComment(comment) }, 201);
  },
);

// ─── DELETE /workspaces/:workspaceId/email-threads/:threadId/comments/:commentId
//
// Author-only hard delete. Any member can read every comment, but 403 here keeps
// deletion to the comment's author. Mention notifications pointing at the
// deleted comment are cleared best-effort so they never dead-end.

threadComments.delete(
  "/workspaces/:workspaceId/email-threads/:threadId/comments/:commentId",
  async (c) => {
    const parsedParams = params
      .extend({ commentId: z.string().min(1) })
      .safeParse({
        workspaceId: c.req.param("workspaceId"),
        threadId: c.req.param("threadId"),
        commentId: c.req.param("commentId"),
      });
    if (!parsedParams.success) return c.json({ error: "Invalid params" }, 400);
    const { workspaceId, threadId, commentId } = parsedParams.data;
    const userId = c.get("userId");

    const comment = await db.threadComment.findFirst({
      where: { id: commentId, emailThreadId: threadId, workspaceId },
      select: { id: true, authorUserId: true },
    });
    if (!comment) return c.json({ error: "Comment not found" }, 404);
    if (comment.authorUserId !== userId) {
      return c.json({ error: "Only the author can delete a comment" }, 403);
    }

    await db.threadComment.delete({ where: { id: commentId } });

    await recordAudit({
      workspaceId,
      actorType: "USER",
      actorUserId: userId,
      eventType: "comment.deleted",
      entityType: "ThreadComment",
      entityId: commentId,
      metadata: { threadId },
    });

    try {
      await deleteCommentMentionNotifications({ workspaceId, commentId });
    } catch (err) {
      console.error(
        "[thread-comments] Failed to clear mention notifications:",
        err instanceof Error ? err.message : err,
      );
    }

    return c.json({ ok: true });
  },
);

export { threadComments as threadCommentsRoute };
