import { db } from "@amarnai/db";

// The single definition of "a thread, in full" as the API hands it out. Two
// routes serve it: /email-threads/:threadId (addressed by our id) and
// /provider-threads/:providerThreadId (addressed by the mailbox's id, for the
// panel injected into Gmail/Outlook). They must not drift — a thread opened
// inside Gmail has to look exactly like the same thread opened in the web app.

// With Ollama (concurrency=1), a job can wait several minutes in the queue
// before the worker picks it up — especially when other classify jobs are ahead.
// 15 minutes covers realistic queue depths (up to ~5 jobs × ~3 min each).
// The worker re-stamps classifyingAt at pickup (step 1b), resetting the timer
// for the active phase. The cost of increasing this threshold is that a
// crashed-worker's stale indicator takes longer to clear (acceptable trade-off).
const CLASSIFY_STALE_MS = 15 * 60 * 1_000;
const DRAFT_GENERATING_STALE_MS = 5 * 60 * 1_000;

export function deriveIsClassifying(classifyingAt: Date | null): boolean {
  if (!classifyingAt) return false;
  return Date.now() - classifyingAt.getTime() < CLASSIFY_STALE_MS;
}

export function deriveIsDrafting(drafts: Array<{ status: string; createdAt: Date }>): boolean {
  return drafts.some(
    (d) => d.status === "GENERATING" && Date.now() - d.createdAt.getTime() < DRAFT_GENERATING_STALE_MS
  );
}

export const THREAD_DETAIL_SELECT = {
  id: true,
  subject: true,
  provider: true,
  providerThreadId: true,
  webLink: true,
  latestMessageAt: true,
  messageCount: true,
  triageStatus: true,
  classifyingAt: true,
  createdAt: true,
  updatedAt: true,
  isImportant: true,
  resolvedByUserId: true,
  resolvedAt: true,
  resolvedByUser: {
    select: { id: true, email: true, name: true },
  },
  assignedToUserId: true,
  assignedAt: true,
  assignedToUser: {
    select: { id: true, email: true, name: true },
  },
  messages: {
    orderBy: { receivedAt: "asc" } as const,
    select: {
      id: true,
      senderEmail: true,
      senderName: true,
      subject: true,
      snippet: true,
      bodyText: true,
      receivedAt: true,
      hasAttachments: true,
      attachments: true,
      toEmails: true,
    },
  },
  classifications: {
    orderBy: { createdAt: "desc" } as const,
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
      decisionSource: true,
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
  drafts: {
    where: { status: { in: ["PROPOSED", "GENERATING"] as ("PROPOSED" | "GENERATING")[] } },
    take: 2,
    select: { id: true, status: true, createdAt: true },
  },
};

type ThreadDetailRow = Awaited<
  ReturnType<typeof db.emailThread.findFirst<{ select: typeof THREAD_DETAIL_SELECT }>>
>;

/**
 * Turn the raw row into the wire shape: derived flags instead of raw
 * timestamps, the latest classification flattened out of its array, and the
 * done/assignment marks folded into single objects (or null).
 */
export function serializeThreadDetail(thread: NonNullable<ThreadDetailRow>) {
  const {
    classifications, classifyingAt, drafts,
    resolvedByUserId, resolvedAt, resolvedByUser,
    assignedToUserId, assignedAt, assignedToUser,
    messages, ...rest
  } = thread;
  return {
    ...rest,
    messages: messages.map((m) => ({
      ...m,
      bodyText: m.bodyText ? m.bodyText.replace(/\[cid:[^\]]+\]/gi, "").trim() || null : null,
    })),
    isClassifying: deriveIsClassifying(classifyingAt),
    isQueued: classifyingAt !== null,
    hasDraft: drafts.some((d) => d.status === "PROPOSED"),
    isDrafting: deriveIsDrafting(drafts),
    latestClassification: classifications[0] ?? null,
    doneMark: resolvedByUserId && resolvedAt && resolvedByUser
      ? {
          userId: resolvedByUserId,
          userEmail: resolvedByUser.email,
          userName: resolvedByUser.name,
          resolvedAt: resolvedAt.toISOString(),
        }
      : null,
    assignment: assignedToUserId && assignedAt && assignedToUser
      ? {
          userId: assignedToUserId,
          userEmail: assignedToUser.email,
          userName: assignedToUser.name,
          assignedAt: assignedAt.toISOString(),
        }
      : null,
  };
}

/** Load + serialize one thread, workspace-scoped. Null when it does not exist. */
export async function loadThreadDetail(workspaceId: string, threadId: string) {
  const thread = await db.emailThread.findFirst({
    where: { id: threadId, workspaceId },
    select: THREAD_DETAIL_SELECT,
  });
  return thread ? serializeThreadDetail(thread) : null;
}
