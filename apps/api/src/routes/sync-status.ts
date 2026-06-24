import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { isTaxonomyRoutable } from "@amarnai/shared";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const syncStatus = new Hono();

/**
 * GET /workspaces/:workspaceId/sync-status
 *
 * Returns the current ProviderSyncState for the workspace's connected Gmail
 * inbox, or null if no sync has run yet (no EmailAccount or no
 * ProviderSyncState row exists).
 */
syncStatus.get("/workspaces/:workspaceId/sync-status", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  // Resolve the GmailConnection → EmailAccount → ProviderSyncState chain.
  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { googleSubjectId: true, gmailAddress: true, gmailWatchExpiresAt: true },
  });

  if (!connection) return c.json(null, 200);

  const providerAccountId = connection.googleSubjectId ?? connection.gmailAddress;

  const account = await db.emailAccount.findUnique({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    select: { id: true },
  });

  if (!account) return c.json(null, 200);

  const [state, syncSettings, workspace] = await Promise.all([
    db.providerSyncState.findUnique({
      where: { emailAccountId: account.id },
      select: {
        status: true,
        lastSyncedAt: true,
        errorMessage: true,
        backfillStatus: true,
        backfillSkipped: true,
        backfillCompletedAt: true,
        backfillCapReached: true,
        backfillBeyondCount: true,
      },
    }),
    db.gmailSyncSettings.findUnique({
      where: { workspaceId },
      select: { sortingPaused: true, includeSpam: true, includePromotions: true },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true },
    }),
  ]);

  if (!state) return c.json(null, 200);

  const now = new Date();
  const pushEnabled =
    connection.gmailWatchExpiresAt != null && connection.gmailWatchExpiresAt > now;

  // Sorting progress is only meaningful while a backfill is running. When it is,
  // report how many of the discovered, inbox-visible threads have finished
  // classification (any terminal status) versus the total discovered so far, and
  // whether the taxonomy is too small to route at all. This drives the backfill
  // card's wording and progress bar; it is the same inbox filter the triage queue
  // counts use, so the numbers line up with the Pending/Sorted pills.
  let backfillAwaitingTaxonomy = false;
  let backfillSortedThreads = 0;
  let backfillTotalThreads = 0;

  if (state.backfillStatus === "RUNNING") {
    const inboxVisible = {
      workspaceId,
      gmailIsTrash: false,
      ...(syncSettings?.includeSpam ? {} : { gmailIsSpam: false }),
      ...(syncSettings?.includePromotions ? {} : { gmailIsPromotions: false }),
    } as const;

    const [taxonomyNodes, taxonomyEdges, grouped] = await Promise.all([
      db.taxonomyNode.findMany({
        where: { workspaceId },
        select: { id: true, isRoot: true, isCatchAll: true },
      }),
      db.taxonomyEdge.findMany({
        where: { workspaceId },
        select: { sourceNodeId: true, targetNodeId: true },
      }),
      db.emailThread.groupBy({
        by: ["triageStatus"],
        where: inboxVisible,
        _count: { _all: true },
      }),
    ]);

    backfillAwaitingTaxonomy = !isTaxonomyRoutable(taxonomyNodes, taxonomyEdges);

    // Total = every inbox-visible thread discovered so far. Pending = not yet run
    // through classification. A thread is "sorted" once it leaves PENDING, whatever
    // the outcome (SORTED / NEEDS_REVIEW / UNROUTED / UNCLASSIFIED).
    for (const g of grouped) {
      backfillTotalThreads += g._count._all;
      if (g.triageStatus !== "PENDING") backfillSortedThreads += g._count._all;
    }
  }

  return c.json({
    status: state.status,
    lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
    errorMessage: state.errorMessage,
    backfillStatus: state.backfillStatus,
    backfillSkipped: state.backfillSkipped,
    backfillCompletedAt: state.backfillCompletedAt?.toISOString() ?? null,
    backfillCapReached: state.backfillCapReached,
    backfillBeyondCount: state.backfillBeyondCount,
    backfillSortedThreads,
    backfillTotalThreads,
    backfillAwaitingTaxonomy,
    sortingPaused: syncSettings?.sortingPaused ?? false,
    workspacePlan: workspace?.plan ?? "FREE",
    pushEnabled,
  });
});

export { syncStatus as syncStatusRoute };
