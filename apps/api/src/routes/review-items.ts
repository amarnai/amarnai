import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const reviewItems = new Hono();

// ─── GET /workspaces/:workspaceId/review-items ────────────────────────────────
//
// Returns all threads whose triageStatus is NEEDS_REVIEW, with their latest
// classification and most recent message for display in the review queue.

reviewItems.get("/workspaces/:workspaceId/review-items", async (c) => {
  const parsed = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }
  const { workspaceId } = parsed.data;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const threads = await db.emailThread.findMany({
    where: { workspaceId, triageStatus: "NEEDS_REVIEW" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      subject: true,
      latestMessageAt: true,
      triageStatus: true,
      tags: {
        select: {
          id: true,
          source: true,
          tag: { select: { id: true, name: true, color: true } },
        },
      },
      messages: {
        orderBy: { receivedAt: "desc" },
        take: 1,
        select: {
          id: true,
          senderEmail: true,
          senderName: true,
          snippet: true,
        },
      },
      classifications: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          confidence: true,
          explanation: true,
          priority: true,
          urgency: true,
          needsHumanReview: true,
          finalNode: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Reshape to a stable response format
  const items = threads.map((t) => {
    const cls = t.classifications[0] ?? null;
    const msg = t.messages[0] ?? null;
    return {
      id: t.id,
      triageStatus: t.triageStatus,
      subject: t.subject,
      latestMessageAt: t.latestMessageAt,
      tags: t.tags,
      latestMessage: msg,
      classification: cls,
    };
  });

  return c.json(items);
});

export { reviewItems as reviewItemsRoute };
