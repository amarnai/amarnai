import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const threadParam = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

/** A classify-thread job stamped more than 2 minutes ago is considered stale. */
const CLASSIFY_STALE_MS = 2 * 60 * 1_000;

function deriveIsClassifying(classifyingAt: Date | null): boolean {
  if (!classifyingAt) return false;
  return Date.now() - classifyingAt.getTime() < CLASSIFY_STALE_MS;
}

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
          triageStatus: true,
          classifyingAt: true,
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

  const threads = workspace.emailThreads.map((thread) => {
    const { classifications, classifyingAt, ...rest } = thread;
    return {
      ...rest,
      isClassifying: deriveIsClassifying(classifyingAt),
      latestClassification: classifications[0] ?? null,
    };
  });
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
        triageStatus: true,
        classifyingAt: true,
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
      },
    });

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const { classifications, classifyingAt, ...rest } = thread;
    return c.json({
      ...rest,
      isClassifying: deriveIsClassifying(classifyingAt),
      latestClassification: classifications[0] ?? null,
    });
  }
);

export { emailThreads as emailThreadsRoute };
