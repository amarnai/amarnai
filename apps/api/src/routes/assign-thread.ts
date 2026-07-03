import { Hono } from "hono";
import { z } from "zod";
import { db, createNotification } from "@amarnai/db";
import type { AppEnv } from "../env.js";
import { recordAudit } from "../services/audit.js";
import { pushNotificationQueue } from "../queues.js";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const assignBody = z.object({
  assigneeUserId: z.string().min(1),
});

const assignThread = new Hono<AppEnv>();

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/assignee ────────────
//
// Assign (or reassign) the thread to a workspace member. Idempotent set: calling
// again with a different assignee simply replaces. The actor is always the
// authenticated user (requireWorkspaceMember already confirmed membership); we
// never read the actor id from the body, and `assignedByUserId` is set from the
// context so a member cannot attribute the action to someone else (IDOR).
//
// The assignee must be validated as a member of THIS workspace: without the
// check, any member could assign a thread to an arbitrary user id.

assignThread.post(
  "/workspaces/:workspaceId/email-threads/:threadId/assignee",
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
    const parsedBody = assignBody.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json({ error: "Invalid body" }, 400);
    }

    const { workspaceId, threadId } = parsedParams.data;
    const { assigneeUserId } = parsedBody.data;
    const actorUserId = c.get("userId");

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true, subject: true },
    });
    if (!thread) return c.json({ error: "Thread not found" }, 404);

    // The assignee must belong to this workspace.
    const assigneeMember = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: assigneeUserId } },
      select: { userId: true },
    });
    if (!assigneeMember) {
      return c.json({ error: "User is not a member of this workspace" }, 400);
    }

    const now = new Date();
    await db.emailThread.update({
      where: { id: threadId },
      data: {
        assignedToUserId: assigneeUserId,
        assignedByUserId: actorUserId,
        assignedAt: now,
      },
    });

    const assignee = await db.user.findUnique({
      where: { id: assigneeUserId },
      select: { id: true, email: true, name: true },
    });

    await recordAudit({
      workspaceId,
      actorType: "USER",
      actorUserId,
      eventType: "thread.assigned",
      entityType: "EmailThread",
      entityId: threadId,
      metadata: { assigneeUserId },
    });

    // Notify the assignee — but never when you assign yourself (you already
    // know). Both the in-app notification and the push are best-effort and must
    // not fail the assignment.
    if (assigneeUserId !== actorUserId) {
      const actor = await db.user.findUnique({
        where: { id: actorUserId },
        select: { email: true, name: true },
      });
      try {
        await createNotification({
          userId: assigneeUserId,
          workspaceId,
          type: "thread_assigned",
          params: {
            threadId,
            subject: thread.subject ?? null,
            assignedByUserId: actorUserId,
            assignedByName: actor?.name ?? null,
            assignedByEmail: actor?.email ?? null,
          },
        });
      } catch (err) {
        console.error(
          "[assign-thread] Failed to create notification:",
          err instanceof Error ? err.message : err
        );
      }
      try {
        await pushNotificationQueue.add("thread_assigned", {
          kind: "thread_assigned",
          workspaceId,
          emailThreadId: threadId,
          assigneeUserId,
          assignedByUserId: actorUserId,
        });
      } catch (err) {
        console.error(
          "[assign-thread] Failed to enqueue push:",
          err instanceof Error ? err.message : err
        );
      }
    }

    return c.json({
      ok: true,
      assignment: {
        userId: assigneeUserId,
        userEmail: assignee!.email,
        userName: assignee!.name,
        assignedAt: now.toISOString(),
      },
    });
  }
);

// ─── DELETE /workspaces/:workspaceId/email-threads/:threadId/assignee ──────────
//
// Clear the assignment. Membership is enforced by requireWorkspaceMember; no
// actor id is read from the body.

assignThread.delete(
  "/workspaces/:workspaceId/email-threads/:threadId/assignee",
  async (c) => {
    const parsedParams = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsedParams.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId } = parsedParams.data;
    const actorUserId = c.get("userId");

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true, assignedToUserId: true },
    });
    if (!thread) return c.json({ error: "Thread not found" }, 404);

    await db.emailThread.update({
      where: { id: threadId },
      data: {
        assignedToUserId: null,
        assignedByUserId: null,
        assignedAt: null,
      },
    });

    await recordAudit({
      workspaceId,
      actorType: "USER",
      actorUserId,
      eventType: "thread.unassigned",
      entityType: "EmailThread",
      entityId: threadId,
      metadata: { previousAssigneeUserId: thread.assignedToUserId },
    });

    return c.json({ ok: true, assignment: null });
  }
);

export { assignThread as assignThreadRoute };
