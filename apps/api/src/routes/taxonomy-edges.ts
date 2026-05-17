import { Hono } from "hono";
import { z } from "zod";
import { db } from "@genizor/db";

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
  sortingQuestion: true,
  examples: true,
  negativeExamples: true,
  priority: true,
  confidenceThreshold: true,
  createdAt: true,
  updatedAt: true,
} as const;

const createBodySchema = z.object({
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sortingQuestion: z.string().min(1).max(160),
  examples: z.array(z.string()).optional(),
  negativeExamples: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
  confidenceThreshold: z.number().min(0).max(1).nullable().optional(),
});

const updateBodySchema = createBodySchema
  .omit({ sourceNodeId: true, targetNodeId: true })
  .partial();

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
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
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
      select: { id: true, workspaceId: true, isRoot: true },
    }),
    db.taxonomyNode.findUnique({
      where: { id: d.targetNodeId },
      select: { id: true, workspaceId: true, isRoot: true },
    }),
  ]);

  if (!sourceNode || sourceNode.workspaceId !== workspaceId) {
    return c.json({ error: "Source node not found" }, 404);
  }
  if (!targetNode || targetNode.workspaceId !== workspaceId) {
    return c.json({ error: "Target node not found" }, 404);
  }
  if (targetNode.isRoot) {
    return c.json({ error: "Cannot create an edge targeting the root node" }, 422);
  }

  const duplicate = await db.taxonomyEdge.findFirst({
    where: { workspaceId, sourceNodeId: d.sourceNodeId, targetNodeId: d.targetNodeId },
    select: { id: true },
  });
  if (duplicate) {
    return c.json({ error: "An edge between these nodes already exists" }, 422);
  }

  if (await hasCycle(workspaceId, d.sourceNodeId, d.targetNodeId)) {
    return c.json({ error: "Creating this edge would introduce a cycle" }, 422);
  }

  const edge = await db.taxonomyEdge.create({
    data: {
      workspaceId,
      sourceNodeId: d.sourceNodeId,
      targetNodeId: d.targetNodeId,
      sortingQuestion: d.sortingQuestion,
      ...(d.examples !== undefined ? { examples: d.examples } : {}),
      ...(d.negativeExamples !== undefined ? { negativeExamples: d.negativeExamples } : {}),
      ...(d.priority !== undefined ? { priority: d.priority } : {}),
      ...(d.confidenceThreshold != null ? { confidenceThreshold: d.confidenceThreshold } : {}),
    },
    select: edgeSelect,
  });

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
    const d = body.data;

    const existing = await db.taxonomyEdge.findUnique({
      where: { id: edgeId },
      select: { id: true, workspaceId: true },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json({ error: "Edge not found" }, 404);
    }

    const updated = await db.taxonomyEdge.update({
      where: { id: edgeId },
      data: {
        ...(d.sortingQuestion !== undefined ? { sortingQuestion: d.sortingQuestion } : {}),
        ...(d.examples !== undefined ? { examples: d.examples } : {}),
        ...(d.negativeExamples !== undefined ? { negativeExamples: d.negativeExamples } : {}),
        ...(d.priority !== undefined ? { priority: d.priority } : {}),
        ...(d.confidenceThreshold !== undefined
          ? { confidenceThreshold: d.confidenceThreshold }
          : {}),
      },
      select: edgeSelect,
    });

    return c.json(updated);
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
      select: { id: true, workspaceId: true },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json({ error: "Edge not found" }, 404);
    }

    await db.taxonomyEdge.delete({ where: { id: edgeId } });
    return c.json({ ok: true });
  }
);

export { taxonomyEdges as taxonomyEdgesRoute };
