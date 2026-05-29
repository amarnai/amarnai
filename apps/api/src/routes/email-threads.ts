import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const threadParam = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const VALID_TRIAGE_STATUSES = ["PENDING", "SORTED", "NEEDS_REVIEW"] as const;
type TriageStatusValue = typeof VALID_TRIAGE_STATUSES[number];

// With Ollama (concurrency=1), a job can wait several minutes in the queue
// before the worker picks it up — especially when other classify jobs are ahead.
// 15 minutes covers realistic queue depths (up to ~5 jobs × ~3 min each).
// The worker re-stamps classifyingAt at pickup (step 1b), resetting the timer
// for the active phase. The cost of increasing this threshold is that a
// crashed-worker's stale indicator takes longer to clear (acceptable trade-off).
const CLASSIFY_STALE_MS = 15 * 60 * 1_000;
const DRAFT_GENERATING_STALE_MS = 5 * 60 * 1_000;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

function deriveIsClassifying(classifyingAt: Date | null): boolean {
  if (!classifyingAt) return false;
  return Date.now() - classifyingAt.getTime() < CLASSIFY_STALE_MS;
}

function deriveIsDrafting(drafts: Array<{ status: string; createdAt: Date }>): boolean {
  return drafts.some(
    (d) => d.status === "GENERATING" && Date.now() - d.createdAt.getTime() < DRAFT_GENERATING_STALE_MS
  );
}

// ─── Cursor helpers ───────────────────────────────────────────────────────────
//
// Cursor encodes the last-seen (latestMessageAt, id) pair so the next page
// query can pick up exactly where the previous one left off. base64url keeps
// the value URL-safe without additional encoding.
//
// Sort order: latestMessageAt DESC NULLS LAST, id DESC
// Null-thread handling:
//   - When cursor.lat is non-null: include OR latestMessageAt IS NULL so that
//     threads with no latestMessageAt (sorted last) are captured on subsequent
//     pages.
//   - When cursor.lat is null: we are already in the null zone; only match
//     null-latestMessageAt threads with a smaller id.

type PageCursor = { lat: string | null; id: string };

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(encoded: string): PageCursor | null {
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p["id"] !== "string") return null;
    if (p["lat"] !== null && typeof p["lat"] !== "string") return null;
    return { lat: (p["lat"] as string | null) ?? null, id: p["id"] as string };
  } catch {
    return null;
  }
}

function buildCursorWhere(cursor: PageCursor) {
  if (cursor.lat === null) {
    // Already in the null zone — only null-latestMessageAt threads with a
    // smaller id remain.
    return { latestMessageAt: null, id: { lt: cursor.id } };
  }
  const cursorDate = new Date(cursor.lat);
  return {
    OR: [
      { latestMessageAt: { lt: cursorDate } },
      { latestMessageAt: cursorDate, id: { lt: cursor.id } },
      // null threads sort after all dated threads (NULLS LAST).
      { latestMessageAt: null },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────

const emailThreads = new Hono();

emailThreads.get("/workspaces/:workspaceId/email-threads", async (c) => {
  const parsed = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }
  const { workspaceId } = parsed.data;

  // Parse filter query params.
  const rawNodeId  = c.req.query("nodeId");
  const rawStatus  = c.req.query("status");
  const rawCursor  = c.req.query("cursor");
  const rawLimit   = c.req.query("limit");

  const nodeId = rawNodeId && rawNodeId.length > 0 ? rawNodeId : null;
  const triageStatus: TriageStatusValue | null =
    rawStatus && (VALID_TRIAGE_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as TriageStatusValue)
      : null;
  const cursor  = rawCursor ? decodeCursor(rawCursor) : null;
  const limit   = Math.min(
    MAX_PAGE_LIMIT,
    Math.max(1, parseInt(rawLimit ?? String(DEFAULT_PAGE_LIMIT), 10) || DEFAULT_PAGE_LIMIT)
  );

  // Verify workspace exists.
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  // Load sync settings to determine which threads should be visible.
  const syncSettingsRow = await db.gmailSyncSettings.findUnique({
    where: { workspaceId },
    select: { includeSpam: true, includePromotions: true },
  });
  const syncSettings = syncSettingsRow ?? DEFAULT_GMAIL_SYNC_SETTINGS;

  // baseWhere: visibility filters only (no status/node/cursor).
  // Used for the global counts so pill totals stay accurate regardless of
  // which filter is active.
  const baseWhere = {
    workspaceId,
    gmailIsTrash: false,
    ...(syncSettings.includeSpam       ? {} : { gmailIsSpam: false }),
    ...(syncSettings.includePromotions ? {} : { gmailIsPromotions: false }),
  };

  // fullWhere: adds status, node, and cursor conditions on top of baseWhere.
  const fullWhere = {
    ...baseWhere,
    ...(triageStatus ? { triageStatus }                                     : {}),
    ...(nodeId       ? { classifications: { some: { finalNodeId: nodeId } } } : {}),
    ...(cursor       ? buildCursorWhere(cursor)                             : {}),
  };

  const threadSelect = {
    id: true,
    subject: true,
    latestMessageAt: true,
    messageCount: true,
    triageStatus: true,
    classifyingAt: true,
    createdAt: true,
    messages: {
      orderBy: { receivedAt: "desc" } as const,
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
        tag: { select: { id: true, name: true, color: true } },
      },
    },
    classifications: {
      orderBy: { createdAt: "desc" } as const,
      take: 1,
      select: {
        id: true,
        priority: true,
        urgency: true,
        confidence: true,
        needsHumanReview: true,
        finalNode: { select: { id: true, name: true } },
      },
    },
    drafts: {
      where: { status: { in: ["PROPOSED", "GENERATING"] as ("PROPOSED" | "GENERATING")[] } },
      take: 2,
      select: { id: true, status: true, createdAt: true },
    },
  };

  // Fetch one extra row to detect whether a next page exists, and run the
  // status-count groupBy in parallel.
  const [rawThreads, grouped] = await Promise.all([
    db.emailThread.findMany({
      where: fullWhere,
      orderBy: [
        { latestMessageAt: { sort: "desc", nulls: "last" } },
        { id: "desc" },
      ],
      take: limit + 1,
      select: threadSelect,
    }),
    db.emailThread.groupBy({
      by: ["triageStatus"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  // Build the next-page cursor from the last item in the current page.
  const hasNextPage = rawThreads.length > limit;
  const pageThreads = hasNextPage ? rawThreads.slice(0, limit) : rawThreads;
  const lastThread  = pageThreads.at(-1);
  const nextCursor  = hasNextPage && lastThread
    ? encodeCursor({
        lat: lastThread.latestMessageAt?.toISOString() ?? null,
        id:  lastThread.id,
      })
    : null;

  // Transform grouped counts.
  const counts = {
    total:        grouped.reduce((s, g) => s + g._count._all, 0),
    PENDING:      grouped.find((g) => g.triageStatus === "PENDING")?._count._all      ?? 0,
    SORTED:       grouped.find((g) => g.triageStatus === "SORTED")?._count._all       ?? 0,
    NEEDS_REVIEW: grouped.find((g) => g.triageStatus === "NEEDS_REVIEW")?._count._all ?? 0,
  };

  const threads = pageThreads.map((thread) => {
    const { classifications, classifyingAt, drafts, ...rest } = thread;
    return {
      ...rest,
      isClassifying: deriveIsClassifying(classifyingAt),
      // true whenever classifyingAt is set, regardless of staleness — the
      // thread has a classify job enqueued or in progress.
      isQueued: classifyingAt !== null,
      latestClassification: classifications[0] ?? null,
      hasDraft: drafts.some((d) => d.status === "PROPOSED"),
      isDrafting: deriveIsDrafting(drafts),
    };
  });

  return c.json({ threads, nextCursor, counts });
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
