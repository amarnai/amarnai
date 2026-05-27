import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const threadParam = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

// With Ollama (concurrency=1), a job can wait several minutes in the queue
// before the worker picks it up — especially when other classify jobs are ahead.
// 15 minutes covers realistic queue depths (up to ~5 jobs × ~3 min each).
// The worker re-stamps classifyingAt at pickup (step 1b), resetting the timer
// for the active phase. The cost of increasing this threshold is that a
// crashed-worker's stale indicator takes longer to clear (acceptable trade-off).
const CLASSIFY_STALE_MS = 15 * 60 * 1_000;

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

  // Load sync settings to determine which threads should be visible.
  const syncSettingsRow = await db.gmailSyncSettings.findUnique({
    where: { workspaceId: parsed.data.workspaceId },
    select: { includeSpam: true, includePromotions: true },
  });
  const syncSettings = syncSettingsRow ?? DEFAULT_GMAIL_SYNC_SETTINGS;

  // Trash is always excluded; spam/promotions depend on user settings.
  const threadWhere = {
    gmailIsTrash: false,
    ...(syncSettings.includeSpam       ? {} : { gmailIsSpam: false }),
    ...(syncSettings.includePromotions ? {} : { gmailIsPromotions: false }),
  };

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: {
      emailThreads: {
        where: threadWhere,
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
      // true whenever classifyingAt is set, regardless of staleness — the
      // thread has a classify job enqueued or in progress.
      isQueued: classifyingAt !== null,
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
      isQueued: classifyingAt !== null,
      latestClassification: classifications[0] ?? null,
    });
  }
);

export { emailThreads as emailThreadsRoute };
