import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";
import { createMailProvider } from "@amarnai/mail";
import { sniffImageContentType } from "../services/image-sniff.js";
import type { AppEnv } from "../env.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const threadParam = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const VALID_TRIAGE_STATUSES = ["PENDING", "SORTED", "NEEDS_REVIEW", "UNROUTED", "UNCLASSIFIED"] as const;
type TriageStatusValue = typeof VALID_TRIAGE_STATUSES[number];

// Cap the search term length to keep the LIKE query bounded.
const MAX_SEARCH_LEN = 200;

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

// ─── Inline image (CID) preview constants ──────────────────────────────────────
// Only these raster types are surfaced/served; SVG is excluded (script vector).
const INLINE_IMAGE_MIME_ALLOWLIST = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
// Bound per-image bytes (cost + latency) and per-message count (UI + fetch fan-out).
const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const INLINE_IMAGE_MAX_PER_MESSAGE = 8;
// Reject absurd attachment ids early (they are opaque provider tokens).
const MAX_ATTACHMENT_ID_LEN = 2048;

/** Descriptor the client turns into an <img> proxy URL. */
type InlineImageDescriptor = { attachmentId: string; mimeType: string; filename: string | null };

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

const emailThreads = new Hono<AppEnv>();

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
  const rawImportant = c.req.query("important");
  const rawAssigned  = c.req.query("assigned");
  const rawQuery   = c.req.query("q");

  // The authenticated user (guaranteed by requireWorkspaceMember). Drives the
  // "Assigned" view/count, which is scoped to threads assigned to this user.
  const currentUserId = c.get("userId") as string;

  const nodeId = rawNodeId && rawNodeId.length > 0 ? rawNodeId : null;
  const triageStatus: TriageStatusValue | null =
    rawStatus && (VALID_TRIAGE_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as TriageStatusValue)
      : null;
  const importantOnly = rawImportant === "true";
  const assignedOnly = rawAssigned === "true";
  const search = (rawQuery ?? "").trim().slice(0, MAX_SEARCH_LEN);
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
    select: { includeSpam: true, includePromotions: true, blacklistedSenderEmails: true },
  });
  const syncSettings = syncSettingsRow ?? DEFAULT_GMAIL_SYNC_SETTINGS;

  // baseWhere: visibility filters only (no status/node/cursor).
  // Used for the global counts so pill totals stay accurate regardless of
  // which filter is active.
  const blacklist = syncSettings.blacklistedSenderEmails ?? [];
  const baseWhere = {
    workspaceId,
    gmailIsTrash: false,
    ...(syncSettings.includeSpam       ? {} : { gmailIsSpam: false }),
    ...(syncSettings.includePromotions ? {} : { gmailIsPromotions: false }),
    ...(blacklist.length > 0
      ? { NOT: { messages: { some: { senderEmail: { in: blacklist } } } } }
      : {}),
  };

  // Search across the thread subject and its messages' sender + snippet.
  const searchWhere = search.length > 0
    ? {
        OR: [
          { subject: { contains: search, mode: "insensitive" as const } },
          { messages: { some: { OR: [
            { senderName:  { contains: search, mode: "insensitive" as const } },
            { senderEmail: { contains: search, mode: "insensitive" as const } },
            { snippet:     { contains: search, mode: "insensitive" as const } },
          ] } } },
        ],
      }
    : {};

  // viewWhere: the active view (queue/folder) + search, but NOT the page cursor.
  // Drives the "X threads" count so it reflects the whole matching set, not the
  // loaded page.
  const viewWhere = {
    ...baseWhere,
    ...(triageStatus  ? { triageStatus }                                      : {}),
    ...(importantOnly ? { isImportant: true }                                 : {}),
    ...(assignedOnly  ? { assignedToUserId: currentUserId }                   : {}),
    ...(nodeId        ? { classifications: { some: { finalNodeId: nodeId } } } : {}),
    ...searchWhere,
  };

  // fullWhere: the view plus the page cursor (the actual page query).
  const fullWhere = {
    ...viewWhere,
    ...(cursor ? buildCursorWhere(cursor) : {}),
  };

  const threadSelect = {
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
      orderBy: { receivedAt: "desc" } as const,
      select: {
        id: true,
        senderEmail: true,
        senderName: true,
        snippet: true,
        receivedAt: true,
        hasAttachments: true,
        attachments: true,
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
  // count queries in parallel. Counts are computed over baseWhere (the whole
  // inbox), not the current page, so the queue pills show true totals regardless
  // of how many threads are loaded. `important` is orthogonal to triageStatus, so
  // it needs its own count.
  const [rawThreads, grouped, importantCount, assignedCount, pendingWaitingCount, filteredTotal] = await Promise.all([
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
    db.emailThread.count({ where: { ...baseWhere, isImportant: true } }),
    // Threads assigned to the current user — drives the "Assigned" pill. Scoped
    // per-user (unlike the status pills), so it counts only this member's queue.
    db.emailThread.count({ where: { ...baseWhere, assignedToUserId: currentUserId } }),
    // Threads waiting to be routed but not yet enqueued — drives the "Route now"
    // banner so it hides once sorting begins. The Pending pill uses the full
    // PENDING count from groupBy (which includes threads currently being sorted).
    db.emailThread.count({ where: { ...baseWhere, triageStatus: "PENDING", classifyingAt: null } }),
    // Count of the active view + search (no cursor): the "X threads" label.
    db.emailThread.count({ where: viewWhere }),
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

  // Transform grouped counts. Every queue pill reads from here.
  const byStatus = (s: string) => grouped.find((g) => g.triageStatus === s)?._count._all ?? 0;
  const counts = {
    total:           grouped.reduce((s, g) => s + g._count._all, 0),
    PENDING:         byStatus("PENDING"),
    PENDING_WAITING: pendingWaitingCount,
    SORTED:          byStatus("SORTED"),
    NEEDS_REVIEW:    byStatus("NEEDS_REVIEW"),
    UNROUTED:        byStatus("UNROUTED"),
    UNCLASSIFIED:    byStatus("UNCLASSIFIED"),
    important:       importantCount,
    assigned:        assignedCount,
  };

  const threads = pageThreads.map((thread) => {
    const {
      classifications, classifyingAt, drafts,
      resolvedByUserId, resolvedAt, resolvedByUser,
      assignedToUserId, assignedAt, assignedToUser,
      ...rest
    } = thread;
    return {
      ...rest,
      isClassifying: deriveIsClassifying(classifyingAt),
      // true whenever classifyingAt is set, regardless of staleness — the
      // thread has a classify job enqueued or in progress.
      isQueued: classifyingAt !== null,
      latestClassification: classifications[0] ?? null,
      hasDraft: drafts.some((d) => d.status === "PROPOSED"),
      isDrafting: deriveIsDrafting(drafts),
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
  });

  return c.json({ threads, nextCursor, counts, filteredTotal });
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
            attachments: true,
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
      },
    });

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const {
      classifications, classifyingAt, drafts,
      resolvedByUserId, resolvedAt, resolvedByUser,
      assignedToUserId, assignedAt, assignedToUser,
      messages, ...rest
    } = thread;
    return c.json({
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
    });
  }
);

// ─── GET /workspaces/:workspaceId/email-threads/:threadId/bodies ───────────────
//
// Fetches full body text for every message in the thread from Gmail in a single
// getThread call. Returns a map of DB message id → body text so the client can
// apply it without a page reload. Returns an empty map for mock inbox threads
// (no Gmail connection) or on Gmail error.

emailThreads.get(
  "/workspaces/:workspaceId/email-threads/:threadId/bodies",
  async (c) => {
    const parsed = threadParam.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId } = parsed.data;

    const [thread, gmailConnection] = await Promise.all([
      db.emailThread.findFirst({
        where: { id: threadId, workspaceId },
        select: {
          providerThreadId: true,
          messages: {
            select: { id: true, providerMessageId: true },
          },
        },
      }),
      db.emailConnection.findUnique({
        where: { workspaceId },
        select: { provider: true, encryptedRefreshToken: true },
      }),
    ]);

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }
    if (!gmailConnection) {
      return c.json({ bodies: {}, inlineImages: {} });
    }

    try {
      const client = createMailProvider(gmailConnection);
      const snapshot = await client.getThreadSnapshot(thread.providerThreadId);
      const snapshotByProviderMsgId = new Map(
        snapshot.messages.map((m) => [m.providerMessageId, m])
      );
      const bodies: Record<string, string | null> = {};
      const inlineImages: Record<string, InlineImageDescriptor[]> = {};
      for (const msg of thread.messages) {
        const snap = snapshotByProviderMsgId.get(msg.providerMessageId);
        bodies[msg.id] = snap?.bodyExcerpt ?? null;
        const descriptors = (snap?.inlineImages ?? [])
          .filter(
            (img) =>
              INLINE_IMAGE_MIME_ALLOWLIST.has(img.mimeType) &&
              !(img.size !== null && img.size > INLINE_IMAGE_MAX_BYTES)
          )
          .slice(0, INLINE_IMAGE_MAX_PER_MESSAGE)
          .map((img) => ({
            attachmentId: img.attachmentId,
            mimeType: img.mimeType,
            filename: img.filename,
          }));
        if (descriptors.length > 0) inlineImages[msg.id] = descriptors;
      }
      return c.json({ bodies, inlineImages });
    } catch {
      return c.json({ bodies: {}, inlineImages: {} });
    }
  }
);

// ─── GET .../email-threads/:threadId/messages/:messageId/inline-image ──────────
//
// Streams the bytes of one CID inline image so the preview can render <img>.
// Auth: inherited workspace-member middleware. Containment: one query proves the
// message belongs to this thread+workspace; the attachmentId is an opaque
// provider token (Gmail ids are ephemeral — a stale one just 404s and the UI
// hides the image), and the provider enforces attachment-belongs-to-message, so
// this is not an open proxy. The response type is decided by sniffing the bytes,
// never by client input, and only png/jpeg/gif/webp are served. Any failure
// degrades to 404 (hidden image); bytes and ids are never logged.

const inlineImageParam = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
  messageId: z.string().min(1),
});

emailThreads.get(
  "/workspaces/:workspaceId/email-threads/:threadId/messages/:messageId/inline-image",
  async (c) => {
    const parsed = inlineImageParam.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
      messageId: c.req.param("messageId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId, messageId } = parsed.data;
    const attachmentId = c.req.query("attachmentId") ?? "";
    if (attachmentId.length === 0 || attachmentId.length > MAX_ATTACHMENT_ID_LEN) {
      return c.json({ error: "Invalid attachment" }, 400);
    }

    try {
      const [message, connection] = await Promise.all([
        db.emailMessage.findFirst({
          where: { id: messageId, thread: { id: threadId, workspaceId } },
          select: { providerMessageId: true },
        }),
        db.emailConnection.findUnique({
          where: { workspaceId },
          select: { provider: true, encryptedRefreshToken: true },
        }),
      ]);
      if (!message || !connection) {
        return c.json({ error: "Not found" }, 404);
      }

      const client = createMailProvider(connection);
      const { data } = await client.getAttachmentContent(message.providerMessageId, attachmentId);
      if (data.byteLength > INLINE_IMAGE_MAX_BYTES) {
        return c.json({ error: "Not found" }, 404);
      }
      const contentType = sniffImageContentType(data);
      if (!contentType) {
        return c.json({ error: "Not found" }, 404);
      }

      // Copy to a fresh, exactly-sized ArrayBuffer (Node Buffers may be pooled
      // views over a larger backing buffer; Hono's body wants a plain buffer).
      const body = new ArrayBuffer(data.byteLength);
      new Uint8Array(body).set(data);
      return c.body(body, 200, {
        "Content-Type": contentType,
        "Content-Length": String(data.byteLength),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      });
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  }
);

export { emailThreads as emailThreadsRoute };
