import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const threadParam = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const emailThreads = new Hono();

emailThreads.get("/workspaces/:workspaceId/email-threads", async (c) => {
  const parsed = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: {
      emailThreads: {
        orderBy: { latestMessageAt: "desc" },
        select: {
          id: true,
          subject: true,
          latestMessageAt: true,
          messageCount: true,
          createdAt: true,
          messages: {
            orderBy: { receivedAt: "desc" },
            take: 1,
            select: {
              id: true,
              senderEmail: true,
              senderName: true,
              snippet: true,
              receivedAt: true,
            },
          },
          tags: {
            select: {
              id: true,
              source: true,
              tag: {
                select: { id: true, name: true, color: true },
              },
            },
          },
          classifications: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              priority: true,
              urgency: true,
              confidence: true,
              needsHumanReview: true,
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

  const threads = workspace.emailThreads.map(({ classifications, ...rest }) => ({
    ...rest,
    latestClassification: classifications[0] ?? null,
  }));
  return c.json(threads);
});

emailThreads.get(
  "/workspaces/:workspaceId/email-threads/:threadId",
  async (c) => {
    const parsed = threadParam.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId } = parsed.data;

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: {
        id: true,
        subject: true,
        latestMessageAt: true,
        messageCount: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { receivedAt: "asc" },
          select: {
            id: true,
            senderEmail: true,
            senderName: true,
            subject: true,
            snippet: true,
            bodyText: true,
            receivedAt: true,
            hasAttachments: true,
            toEmails: true,
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
            riskLevel: true,
            requiredAction: true,
            sensitivity: true,
            dueAt: true,
            suggestedNextStep: true,
            needsHumanReview: true,
            modelProvider: true,
            modelName: true,
            createdAt: true,
            finalNode: {
              select: { id: true, name: true },
            },
          },
        },
        tags: {
          select: {
            id: true,
            source: true,
            tag: {
              select: { id: true, name: true, color: true },
            },
          },
        },
        reviewItems: {
          where: { status: "OPEN" },
          take: 1,
          select: {
            id: true,
            status: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const { classifications, ...rest } = thread;
    return c.json({
      ...rest,
      latestClassification: classifications[0] ?? null,
    });
  }
);

export { emailThreads as emailThreadsRoute };
