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
        backfillProcessedCount: true,
      },
    }),
    db.gmailSyncSettings.findUnique({
      where: { workspaceId },
      select: { sortingPaused: true },
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

  // Backfill loading progress is only meaningful while a backfill is running.
  // While it is, report how many past threads the backfill has processed so far
  // (backfillLoadedThreads) — used for telemetry/debugging; the card itself shows a
  // count-less "loading" indicator since Gmail exposes no reliable total. Also
  // report whether the taxonomy is too small to route any threads yet, which adapts
  // the card wording.
  let backfillAwaitingTaxonomy = false;
  let backfillLoadedThreads = 0;
  const backfillTotalThreads = 0;

  if (state.backfillStatus === "RUNNING") {
    backfillLoadedThreads = state.backfillProcessedCount;

    const [taxonomyNodes, taxonomyEdges] = await Promise.all([
      db.taxonomyNode.findMany({
        where: { workspaceId },
        select: { id: true, isRoot: true, isCatchAll: true },
      }),
      db.taxonomyEdge.findMany({
        where: { workspaceId },
        select: { sourceNodeId: true, targetNodeId: true },
      }),
    ]);

    backfillAwaitingTaxonomy = !isTaxonomyRoutable(taxonomyNodes, taxonomyEdges);
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
    backfillLoadedThreads,
    backfillTotalThreads,
    backfillAwaitingTaxonomy,
    sortingPaused: syncSettings?.sortingPaused ?? false,
    workspacePlan: workspace?.plan ?? "FREE",
    pushEnabled,
  });
});

export { syncStatus as syncStatusRoute };
