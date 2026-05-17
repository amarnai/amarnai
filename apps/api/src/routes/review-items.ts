import { Hono } from "hono";
import { z } from "zod";
import { db } from "@genizor/db";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const reviewItems = new Hono();

reviewItems.get("/workspaces/:workspaceId/review-items", async (c) => {
  const parsed = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: {
      reviewItems: {
        where: { status: "OPEN" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          reason: true,
          createdAt: true,
          updatedAt: true,
          emailThread: {
            select: {
              id: true,
              subject: true,
              latestMessageAt: true,
              tags: {
                select: {
                  id: true,
                  source: true,
                  tag: {
                    select: { id: true, name: true, color: true },
                  },
                },
              },
            },
          },
          emailMessage: {
            select: {
              id: true,
              senderEmail: true,
              senderName: true,
              snippet: true,
            },
          },
          classification: {
            select: {
              id: true,
              confidence: true,
              priority: true,
              urgency: true,
              finalNode: {
                select: { id: true, name: true },
              },
            },
          },
        },
      },
    },
  });

  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json(workspace.reviewItems);
});

export { reviewItems as reviewItemsRoute };
