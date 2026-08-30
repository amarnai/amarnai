import { Hono } from "hono";
import { z } from "zod";
import { db } from "@aziru/db";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const folderCounts = new Hono();

// ─── GET /workspaces/:workspaceId/folder-counts ───────────────────────────────
//
// Returns the number of threads whose latest classification points to each
// taxonomy node, computed via a DB-level aggregation.
//
// "Latest classification" is resolved with DISTINCT ON (emailThreadId) ordered
// by createdAt DESC — the same row the UI shows in the thread list.
//
// Response: { counts: { nodeId: string; count: number }[], total: number }
//   total = sum of all per-node counts (threads that have any classification)

folderCounts.get("/workspaces/:workspaceId/folder-counts", async (c) => {
  const parsed = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }
  const { workspaceId } = parsed.data;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  // Fetch the latest classification per thread using Prisma's distinct +
  // orderBy. The orderBy must include the distinct field first so that
  // DISTINCT ON picks the row with the highest createdAt within each group.
  const latestClassifications = await db.emailClassification.findMany({
    where: { workspaceId, finalNodeId: { not: null } },
    orderBy: [
      { emailThreadId: "asc" },
      { createdAt: "desc" },
    ],
    distinct: ["emailThreadId"],
    select: { finalNodeId: true },
  });

  // Group by finalNodeId in memory — the result set is at most one row per
  // thread, so this is O(n) on classified thread count, not total messages.
  const countMap = new Map<string, number>();
  for (const cls of latestClassifications) {
    if (cls.finalNodeId) {
      countMap.set(cls.finalNodeId, (countMap.get(cls.finalNodeId) ?? 0) + 1);
    }
  }

  const counts = Array.from(countMap.entries()).map(([nodeId, count]) => ({
    nodeId,
    count,
  }));
  const total = counts.reduce((s, c) => s + c.count, 0);

  return c.json({ counts, total });
});

export { folderCounts as folderCountsRoute };
