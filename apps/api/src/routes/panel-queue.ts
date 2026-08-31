import { Hono } from "hono";
import { z } from "zod";
import { db } from "@aziru/db";
import {
  buildThreadVisibilityWhere,
  DEFAULT_THREAD_VISIBILITY,
} from "../services/thread-visibility.js";
import type { AppEnv } from "../env.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

/**
 * Rows per section. The panel is a 280-344px column and the header carries the
 * true count, so this is a preview depth, not a page size: there is no cursor
 * and no "load more". Anyone with more than this to work through wants the web
 * app, which the panel already links to.
 */
const SECTION_TAKE = 15;

/**
 * Enough to render a row and open the thread in the mail client. Deliberately
 * far smaller than the thread list's select: no attachments JSON, no tags, no
 * classifications, and one message rather than all of them. This route runs
 * every time someone navigates back to their inbox, in every open mail tab, so
 * per-call cost is the whole design constraint.
 */
const QUEUE_THREAD_SELECT = {
  id: true,
  subject: true,
  provider: true,
  providerThreadId: true,
  webLink: true,
  latestMessageAt: true,
  resolvedByUserId: true,
  resolvedAt: true,
  resolvedByUser: { select: { id: true, email: true, name: true } },
  messages: {
    orderBy: { receivedAt: "desc" } as const,
    take: 1,
    select: { senderEmail: true, senderName: true },
  },
} as const;

const QUEUE_ORDER = [
  { latestMessageAt: { sort: "desc", nulls: "last" } as const },
  { id: "desc" as const },
];

type QueueThreadRow = {
  id: string;
  subject: string | null;
  provider: string;
  providerThreadId: string;
  webLink: string | null;
  latestMessageAt: Date | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  resolvedByUser: { id: string; email: string; name: string | null } | null;
  messages: { senderEmail: string; senderName: string | null }[];
};

function serialize(thread: QueueThreadRow) {
  const { resolvedByUserId, resolvedAt, resolvedByUser, messages, latestMessageAt, ...rest } =
    thread;
  const latest = messages[0];
  return {
    ...rest,
    latestMessageAt: latestMessageAt?.toISOString() ?? null,
    senderName: latest?.senderName ?? null,
    senderEmail: latest?.senderEmail ?? null,
    // Same shape as the thread list's doneMark, so the panel's done toggle is
    // the same code on both surfaces.
    doneMark:
      resolvedByUserId && resolvedAt && resolvedByUser
        ? {
            userId: resolvedByUserId,
            userEmail: resolvedByUser.email,
            userName: resolvedByUser.name,
            resolvedAt: resolvedAt.toISOString(),
          }
        : null,
  };
}

const panelQueue = new Hono<AppEnv>();

// ─── GET /workspaces/:workspaceId/panel-queue ─────────────────────────────────
//
// What the injected panel shows when no conversation is open: the small set of
// threads actually waiting on this user, plus the two numbers its sorting strip
// needs. One call, because the panel would otherwise make three to the thread
// list route — the heaviest read in the API — for data it renders as four lines
// of text per row.
//
// The three sections are lenses, not one list: a thread with a draft waiting can
// also be assigned and can also need review, and it appears in each. Only the
// assigned section excludes threads marked done, because that section is the
// user's own queue and done means "off my plate"; the other two describe what
// Aziru thinks about a thread, which marking it done does not change.
//
// Gated by the workspace's injected-panel kill switch like the provider-id
// routes: without it a workspace that switched the panel off would still get a
// queue here, since this route resolves no provider thread id and would
// otherwise never consult the flag.

panelQueue.get("/workspaces/:workspaceId/panel-queue", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);
  const { workspaceId } = parsed.data;

  // The authenticated member (guaranteed by requireWorkspaceMember). The
  // assigned section is theirs alone; there is deliberately no way to ask for
  // another member's queue.
  const currentUserId = c.get("userId") as string;

  // One read for both the kill switch and the visibility filters. isInjectionEnabled
  // would re-query the same row; a missing row means defaults, and the panel
  // defaults to on (see provider-thread.ts for why that default is server-side).
  const settings = await db.gmailSyncSettings.findUnique({
    where: { workspaceId },
    select: {
      injectedPanelEnabled: true,
      includeSpam: true,
      includePromotions: true,
      blacklistedSenderEmails: true,
    },
  });
  if (settings && !settings.injectedPanelEnabled) {
    return c.json(
      {
        error: "The in-mail panel is disabled for this workspace",
        injectionDisabled: true,
      },
      403,
    );
  }

  const visible = buildThreadVisibilityWhere(workspaceId, settings ?? DEFAULT_THREAD_VISIBILITY);

  const assignedWhere = {
    ...visible,
    assignedToUserId: currentUserId,
    resolvedAt: null,
  };
  const needsReviewWhere = { ...visible, triageStatus: "NEEDS_REVIEW" as const };
  // An exists-probe over the workspace's drafts. PROPOSED is the awaiting-approval
  // state; GENERATING drafts are still being written and have nothing to approve.
  const draftsWhere = {
    ...visible,
    drafts: { some: { status: "PROPOSED" as const } },
  };

  const [
    assignedThreads,
    needsReviewThreads,
    draftThreads,
    assignedCount,
    needsReviewCount,
    draftCount,
    pendingCount,
    pendingWaitingCount,
  ] = await Promise.all([
    db.emailThread.findMany({
      where: assignedWhere,
      orderBy: QUEUE_ORDER,
      take: SECTION_TAKE,
      select: QUEUE_THREAD_SELECT,
    }),
    db.emailThread.findMany({
      where: needsReviewWhere,
      orderBy: QUEUE_ORDER,
      take: SECTION_TAKE,
      select: QUEUE_THREAD_SELECT,
    }),
    db.emailThread.findMany({
      where: draftsWhere,
      orderBy: QUEUE_ORDER,
      take: SECTION_TAKE,
      select: QUEUE_THREAD_SELECT,
    }),
    db.emailThread.count({ where: assignedWhere }),
    db.emailThread.count({ where: needsReviewWhere }),
    db.emailThread.count({ where: draftsWhere }),
    // Sorting strip. The in-flight count is pending minus pending-waiting: a
    // thread that is waiting has no classify job yet, so it is not being sorted.
    db.emailThread.count({ where: { ...visible, triageStatus: "PENDING" } }),
    db.emailThread.count({
      where: { ...visible, triageStatus: "PENDING", classifyingAt: null },
    }),
  ]);

  return c.json({
    assignedToMe: {
      threads: (assignedThreads as QueueThreadRow[]).map(serialize),
      count: assignedCount,
    },
    needsReview: {
      threads: (needsReviewThreads as QueueThreadRow[]).map(serialize),
      count: needsReviewCount,
    },
    proposedDrafts: {
      threads: (draftThreads as QueueThreadRow[]).map(serialize),
      count: draftCount,
    },
    pendingCount,
    pendingWaitingCount,
  });
});

export { panelQueue as panelQueueRoute };
