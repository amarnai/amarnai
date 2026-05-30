import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const bodySchema = z.object({ userId: z.string().min(1) });

const resolveThread = new Hono();

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/resolve ─────────────
//
// Mark the thread as done. Records which workspace member did it and when.

resolveThread.post(
  "/workspaces/:workspaceId/email-threads/:threadId/resolve",
  async (c) => {
    const parsed = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId } = parsed.data;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: "userId is required" }, 400);
    }
    const { userId } = parsedBody.data;

    const [thread, member] = await Promise.all([
      db.emailThread.findFirst({
        where: { id: threadId, workspaceId },
        select: { id: true },
      }),
      db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { userId: true },
      }),
    ]);

    if (!thread) return c.json({ error: "Thread not found" }, 404);
    if (!member) return c.json({ error: "User is not a member of this workspace" }, 403);

    const now = new Date();
    await db.emailThread.update({
      where: { id: threadId },
      data: { resolvedByUserId: userId, resolvedAt: now },
    });

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    return c.json({
      ok: true,
      doneMark: {
        userId,
        userEmail: user!.email,
        userName: user!.name,
        resolvedAt: now.toISOString(),
      },
    });
  }
);

// ─── DELETE /workspaces/:workspaceId/email-threads/:threadId/resolve ──────────
//
// Clear the done mark from the thread.

resolveThread.delete(
  "/workspaces/:workspaceId/email-threads/:threadId/resolve",
  async (c) => {
    const parsed = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId } = parsed.data;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: "userId is required" }, 400);
    }
    const { userId } = parsedBody.data;

    const [thread, member] = await Promise.all([
      db.emailThread.findFirst({
        where: { id: threadId, workspaceId },
        select: { id: true },
      }),
      db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { userId: true },
      }),
    ]);

    if (!thread) return c.json({ error: "Thread not found" }, 404);
    if (!member) return c.json({ error: "User is not a member of this workspace" }, 403);

    await db.emailThread.update({
      where: { id: threadId },
      data: { resolvedByUserId: null, resolvedAt: null },
    });

    return c.json({ ok: true, doneMark: null });
  }
);

export { resolveThread as resolveThreadRoute };
