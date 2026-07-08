import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { bumpTaxonomyChangedAt } from "../services/taxonomy-changed.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const edgeParam = z.object({
  workspaceId: z.string().min(1),
  edgeId: z.string().min(1),
});

const edgeSelect = {
  id: true,
  workspaceId: true,
  sourceNodeId: true,
  targetNodeId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const createBodySchema = z.object({
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
});

const updateBodySchema = z.object({
  newSourceNodeId: z.string().min(1).optional(),
});

async function hasCycle(
  workspaceId: string,
  sourceNodeId: string,
  targetNodeId: string
): Promise<boolean> {
  if (sourceNodeId === targetNodeId) return true;
  const edges = await db.taxonomyEdge.findMany({
    where: { workspaceId },
    select: { sourceNodeId: true, targetNodeId: true },
  });
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adj.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    adj.set(edge.sourceNodeId, list);
  }
  const visited = new Set<string>();
  const queue = [targetNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === sourceNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adj.get(current) ?? []) {
      queue.push(neighbor);
    }
  }
  return false;
}

const taxonomyEdges = new Hono();

taxonomyEdges.get("/workspaces/:workspaceId/taxonomy-edges", async (c) => {
  const parsed = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: {
      taxonomyEdges: {
        orderBy: { createdAt: "asc" },
        select: edgeSelect,
      },
    },
  });

  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json(workspace.taxonomyEdges);
});

taxonomyEdges.post("/workspaces/:workspaceId/taxonomy-edges", async (c) => {
  const params = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!params.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const body = createBodySchema.safeParse(rawBody);
  if (!body.success) {
    return c.json({ error: "Validation error", issues: body.error.issues }, 400);
  }

  const { workspaceId } = params.data;
  const d = body.data;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const [sourceNode, targetNode] = await Promise.all([
    db.taxonomyNode.findUnique({
      where: { id: d.sourceNodeId },
      select: { id: true, workspaceId: true, isRoot: true, isCatchAll: true },
    }),
    db.taxonomyNode.findUnique({
      where: { id: d.targetNodeId },
      select: { id: true, workspaceId: true, isRoot: true, isCatchAll: true },
    }),
  ]);

  if (!sourceNode || sourceNode.workspaceId !== workspaceId) {
    return c.json({ error: "Source node not found" }, 404);
  }
  if (!targetNode || targetNode.workspaceId !== workspaceId) {
    return c.json({ error: "Target node not found" }, 404);
  }
  // The catch-all is excluded from routing and must remain a leaf; a child under
  // it would be orphaned from the router. Mirrors the import-time check in
  // packages/shared/src/schemas/taxonomy-transfer.ts.
  if (sourceNode.isCatchAll) {
    return c.json({ error: "The catch-all folder must be a leaf (it cannot have sub-folders)" }, 422);
  }
  if (targetNode.isRoot) {
    return c.json({ error: "Cannot create an edge targeting the root node" }, 422);
  }
  // The catch-all hangs directly off the inbox: its only parent may be the root.
  if (targetNode.isCatchAll && !sourceNode.isRoot) {
    return c.json({ error: "The catch-all folder can only be connected directly to the Inbox" }, 422);
  }

  const duplicate = await db.taxonomyEdge.findFirst({
    where: { workspaceId, sourceNodeId: d.sourceNodeId, targetNodeId: d.targetNodeId },
    select: { id: true },
  });
  if (duplicate) {
    return c.json({ error: "An edge between these nodes already exists" }, 422);
  }

  const existingIncoming = await db.taxonomyEdge.findFirst({
    where: { workspaceId, targetNodeId: d.targetNodeId },
    select: { id: true },
  });
  if (existingIncoming) {
    return c.json({ error: "This node already has a parent. Remove the existing connection first." }, 422);
  }

  if (await hasCycle(workspaceId, d.sourceNodeId, d.targetNodeId)) {
    return c.json({ error: "Creating this edge would introduce a cycle" }, 422);
  }

  const edge = await db.taxonomyEdge.create({
    data: {
      workspaceId,
      sourceNodeId: d.sourceNodeId,
      targetNodeId: d.targetNodeId,
    },
    select: edgeSelect,
  });

  // Re-parenting the tree changes routing outcomes — mark review threads re-sortable.
  await bumpTaxonomyChangedAt(workspaceId);

  return c.json(edge, 201);
});

taxonomyEdges.patch(
  "/workspaces/:workspaceId/taxonomy-edges/:edgeId",
  async (c) => {
    const params = edgeParam.safeParse({
      workspaceId: c.req.param("workspaceId"),
      edgeId: c.req.param("edgeId"),
    });
    if (!params.success) {
      return c.json({ error: "Invalid params" }, 400);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const body = updateBodySchema.safeParse(rawBody);
    if (!body.success) {
      return c.json({ error: "Validation error", issues: body.error.issues }, 400);
    }

    const { workspaceId, edgeId } = params.data;
    const { newSourceNodeId } = body.data;

    const existing = await db.taxonomyEdge.findUnique({
      where: { id: edgeId },
      select: {
        id: true,
        workspaceId: true,
        sourceNodeId: true,
        targetNodeId: true,
        targetNode: { select: { isCatchAll: true } },
      },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json({ error: "Edge not found" }, 404);
    }

    if (!newSourceNodeId || newSourceNodeId === existing.sourceNodeId) {
      const unchanged = await db.taxonomyEdge.findUnique({
        where: { id: edgeId },
        select: edgeSelect,
      });
      return c.json(unchanged);
    }

    const newSource = await db.taxonomyNode.findUnique({
      where: { id: newSourceNodeId },
      select: { id: true, workspaceId: true, isRoot: true, isCatchAll: true },
    });
    if (!newSource || newSource.workspaceId !== workspaceId) {
      return c.json({ error: "New source node not found" }, 404);
    }
    // The catch-all must stay a leaf (it is excluded from routing); it cannot
    // become a parent by re-pointing an existing edge either.
    if (newSource.isCatchAll) {
      return c.json({ error: "The catch-all folder must be a leaf (it cannot have sub-folders)" }, 422);
    }
    // The catch-all hangs directly off the inbox: its incoming edge cannot be
    // re-pointed to a non-root parent.
    if (existing.targetNode.isCatchAll && !newSource.isRoot) {
      return c.json({ error: "The catch-all folder can only be connected directly to the Inbox" }, 422);
    }

    const duplicate = await db.taxonomyEdge.findFirst({
      where: { workspaceId, sourceNodeId: newSourceNodeId, targetNodeId: existing.targetNodeId },
      select: { id: true },
    });
    if (duplicate) {
      return c.json({ error: "An edge between these nodes already exists" }, 422);
    }

    if (await hasCycle(workspaceId, newSourceNodeId, existing.targetNodeId)) {
      return c.json({ error: "Moving this edge would introduce a cycle" }, 422);
    }

    const newEdge = await db.$transaction(async (tx) => {
      await tx.taxonomyEdge.delete({ where: { id: edgeId } });
      const created = await tx.taxonomyEdge.create({
        data: { workspaceId, sourceNodeId: newSourceNodeId, targetNodeId: existing.targetNodeId },
        select: edgeSelect,
      });
      await bumpTaxonomyChangedAt(workspaceId, tx);
      return created;
    });

    return c.json(newEdge);
  }
);

taxonomyEdges.delete(
  "/workspaces/:workspaceId/taxonomy-edges/:edgeId",
  async (c) => {
    const params = edgeParam.safeParse({
      workspaceId: c.req.param("workspaceId"),
      edgeId: c.req.param("edgeId"),
    });
    if (!params.success) {
      return c.json({ error: "Invalid params" }, 400);
    }

    const { workspaceId, edgeId } = params.data;

    const existing = await db.taxonomyEdge.findUnique({
      where: { id: edgeId },
      select: {
        id: true,
        workspaceId: true,
        targetNode: { select: { isCatchAll: true } },
      },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json({ error: "Edge not found" }, 404);
    }

    // The catch-all is seeded with a single incoming edge from the inbox so it
    // is never unreachable (packages/db/src/inbox.ts). Deleting that edge would
    // orphan it while it still silently receives all automated/bulk mail, so
    // its incoming edge is not deletable.
    if (existing.targetNode.isCatchAll) {
      return c.json({ error: "Cannot disconnect the catch-all folder from the inbox" }, 422);
    }

    await db.taxonomyEdge.delete({ where: { id: edgeId } });

    // Removing an edge changes routing outcomes — mark review threads re-sortable.
    await bumpTaxonomyChangedAt(workspaceId);

    return c.json({ ok: true });
  }
);

export { taxonomyEdges as taxonomyEdgesRoute };
