import { Hono } from "hono";
import { z } from "zod";
import { db } from "@genizor/db";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const nodeParam = z.object({
  workspaceId: z.string().min(1),
  nodeId: z.string().min(1),
});

const nodeSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  instructions: true,
  examples: true,
  isRoot: true,
  isVisibleCategory: true,
  canReceiveEmails: true,
  positionX: true,
  positionY: true,
  createdAt: true,
  updatedAt: true,
} as const;

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  instructions: z.string().max(2000).nullable().optional(),
  examples: z.array(z.string()).optional(),
  isVisibleCategory: z.boolean().optional(),
  canReceiveEmails: z.boolean().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});

const updateBodySchema = createBodySchema.partial();

const taxonomyNodes = new Hono();

taxonomyNodes.get("/workspaces/:workspaceId/taxonomy-nodes", async (c) => {
  const parsed = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: {
      taxonomyNodes: {
        orderBy: { createdAt: "asc" },
        select: nodeSelect,
      },
    },
  });

  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json(workspace.taxonomyNodes);
});

taxonomyNodes.post("/workspaces/:workspaceId/taxonomy-nodes", async (c) => {
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

  const node = await db.taxonomyNode.create({
    data: {
      workspaceId,
      isRoot: false,
      name: d.name,
      ...(d.description != null ? { description: d.description } : {}),
      ...(d.instructions != null ? { instructions: d.instructions } : {}),
      ...(d.examples !== undefined ? { examples: d.examples } : {}),
      ...(d.isVisibleCategory !== undefined ? { isVisibleCategory: d.isVisibleCategory } : {}),
      ...(d.canReceiveEmails !== undefined ? { canReceiveEmails: d.canReceiveEmails } : {}),
      ...(d.positionX !== undefined ? { positionX: d.positionX } : {}),
      ...(d.positionY !== undefined ? { positionY: d.positionY } : {}),
    },
    select: nodeSelect,
  });

  return c.json(node, 201);
});

taxonomyNodes.patch(
  "/workspaces/:workspaceId/taxonomy-nodes/:nodeId",
  async (c) => {
    const params = nodeParam.safeParse({
      workspaceId: c.req.param("workspaceId"),
      nodeId: c.req.param("nodeId"),
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

    const { workspaceId, nodeId } = params.data;
    const d = body.data;

    if (typeof rawBody === "object" && rawBody !== null && "isRoot" in rawBody) {
      return c.json({ error: "Cannot change isRoot" }, 400);
    }

    const existing = await db.taxonomyNode.findUnique({
      where: { id: nodeId },
      select: { id: true, workspaceId: true, isRoot: true },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json({ error: "Node not found" }, 404);
    }

    if (existing.isRoot && (d.isVisibleCategory !== undefined || d.canReceiveEmails !== undefined)) {
      return c.json(
        { error: "Cannot change isVisibleCategory or canReceiveEmails on the root node" },
        422
      );
    }

    const updated = await db.taxonomyNode.update({
      where: { id: nodeId },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.instructions !== undefined ? { instructions: d.instructions } : {}),
        ...(d.examples !== undefined ? { examples: d.examples } : {}),
        ...(d.isVisibleCategory !== undefined ? { isVisibleCategory: d.isVisibleCategory } : {}),
        ...(d.canReceiveEmails !== undefined ? { canReceiveEmails: d.canReceiveEmails } : {}),
        ...(d.positionX !== undefined ? { positionX: d.positionX } : {}),
        ...(d.positionY !== undefined ? { positionY: d.positionY } : {}),
      },
      select: nodeSelect,
    });

    return c.json(updated);
  }
);

taxonomyNodes.delete(
  "/workspaces/:workspaceId/taxonomy-nodes/:nodeId",
  async (c) => {
    const params = nodeParam.safeParse({
      workspaceId: c.req.param("workspaceId"),
      nodeId: c.req.param("nodeId"),
    });
    if (!params.success) {
      return c.json({ error: "Invalid params" }, 400);
    }

    const { workspaceId, nodeId } = params.data;

    const existing = await db.taxonomyNode.findUnique({
      where: { id: nodeId },
      select: {
        id: true,
        workspaceId: true,
        isRoot: true,
        _count: { select: { outgoingEdges: true, incomingEdges: true, classifications: true } },
      },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json({ error: "Node not found" }, 404);
    }

    if (existing.isRoot) {
      return c.json({ error: "Cannot delete the root node" }, 422);
    }

    if (existing._count.outgoingEdges > 0 || existing._count.incomingEdges > 0) {
      return c.json(
        { error: "Cannot delete a node that has edges" },
        422
      );
    }

    if (existing._count.classifications > 0) {
      return c.json(
        { error: "Cannot delete a node that has email classifications" },
        422
      );
    }

    await db.taxonomyNode.delete({ where: { id: nodeId } });
    return c.json({ ok: true });
  }
);

export { taxonomyNodes as taxonomyNodesRoute };
