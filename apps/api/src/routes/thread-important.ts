import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import type { AppEnv } from "../env.js";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const importantBody = z.object({
  isImportant: z.boolean(),
});

const threadImportant = new Hono<AppEnv>();

// ─── PATCH /workspaces/:workspaceId/email-threads/:threadId/important ───────────
//
// Set (or clear) the user-marked "important" star on a thread. The star is a
// shared, workspace-level flag: any member can toggle it and everyone sees the
// same state. Membership is enforced by the requireWorkspaceMember middleware.
// Idempotent — setting the same value again is a no-op write.

threadImportant.patch(
  "/workspaces/:workspaceId/email-threads/:threadId/important",
  async (c) => {
    const parsedParams = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsedParams.success) {
      return c.json({ error: "Invalid params" }, 400);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid body" }, 400);
    }
    const parsedBody = importantBody.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json({ error: "Invalid body" }, 400);
    }

    const { workspaceId, threadId } = parsedParams.data;
    const { isImportant } = parsedBody.data;

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true },
    });
    if (!thread) return c.json({ error: "Thread not found" }, 404);

    await db.emailThread.update({
      where: { id: threadId },
      data: { isImportant },
    });

    return c.json({ ok: true, isImportant });
  }
);

export { threadImportant as threadImportantRoute };
