import { Hono } from "hono";
import { z } from "zod";
import { db } from "@aziru/db";
import type { AppEnv } from "../env.js";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const resolveThread = new Hono<AppEnv>();

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/resolve ─────────────
//
// Mark the thread as done. The actor is always the authenticated user — the
// requireWorkspaceMember middleware has already confirmed they belong to this
// workspace. We never read the actor id from the request body: doing so let any
// member record the action as another member (IDOR).

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
    const userId = c.get("userId");

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true },
    });
    if (!thread) return c.json({ error: "Thread not found" }, 404);

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
// Clear the done mark from the thread. Membership is enforced by the
// requireWorkspaceMember middleware; no actor id is read from the body.

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

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true },
    });
    if (!thread) return c.json({ error: "Thread not found" }, 404);

    await db.emailThread.update({
      where: { id: threadId },
      data: { resolvedByUserId: null, resolvedAt: null },
    });

    return c.json({ ok: true, doneMark: null });
  }
);

export { resolveThread as resolveThreadRoute };
