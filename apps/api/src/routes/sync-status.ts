import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";

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
    select: { googleSubjectId: true, gmailAddress: true },
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

  return c.json({
    status: state.status,
    lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
    errorMessage: state.errorMessage,
    backfillStatus: state.backfillStatus,
    backfillSkipped: state.backfillSkipped,
    backfillCompletedAt: state.backfillCompletedAt?.toISOString() ?? null,
    sortingPaused: syncSettings?.sortingPaused ?? false,
    workspacePlan: workspace?.plan ?? "FREE",
  });
});

export { syncStatus as syncStatusRoute };
