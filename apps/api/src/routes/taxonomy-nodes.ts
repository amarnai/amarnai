import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { findDescendants } from "@amarnai/ai";
import { bumpTaxonomyChangedAt } from "../services/taxonomy-changed.js";

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
  draftPrompt: true,
  examples: true,
  isRoot: true,
  isCatchAll: true,
  positionX: true,
  positionY: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─── Field-level validators (mirror packages/shared nodeNameSchema / nodeDescriptionSchema) ──

const HTML_TAG_RE = /<[a-zA-Z][^>]*>/;

const nameSchema = z
  .string()
  .trim()
  .min(3, "Name must be at least 3 characters")
  .max(60, "Name must be at most 60 characters")
  .refine(
    (v) => /[\p{L}\p{N}]/u.test(v),
    "Name must contain at least one letter or digit"
  );

const descriptionSchema = z
  .string()
  .trim()
  .max(300, "Description must be at most 300 characters")
  .refine(
    (v) => !HTML_TAG_RE.test(v),
    "Description must be plain text (no HTML). Descriptions improve AI sorting quality."
  )
  .refine(
    (v) => v.replace(/\s/g, "").length >= 30,
    "Description must have at least 30 non-whitespace characters. Descriptions improve AI sorting quality."
  );

// description is required for all non-root node creation (POST always sets isRoot: false)
const createBodySchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    instructions: z.string().max(2000).nullable().optional(),
    draftPrompt: z.string().trim().max(500).nullable().optional(),
    examples: z.array(z.string()).optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.description.trim().toLowerCase() === data.name.trim().toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Description must differ from the node name. Descriptions improve AI sorting quality.",
        path: ["description"],
      });
    }
  });

const updateBodySchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    instructions: z.string().max(2000).nullable().optional(),
    draftPrompt: z.string().trim().max(500).nullable().optional(),
    examples: z.array(z.string()).optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.name !== undefined &&
      data.description !== undefined &&
      data.description.trim().toLowerCase() === data.name.trim().toLowerCase()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Description must differ from the node name. Descriptions improve AI sorting quality.",
        path: ["description"],
      });
    }
  });

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

  const threadCounts = await db.$queryRaw<{ finalNodeId: string; count: bigint }[]>`
    SELECT "finalNodeId", COUNT(DISTINCT "emailThreadId") as count
    FROM "EmailClassification"
    WHERE "workspaceId" = ${parsed.data.workspaceId} AND "finalNodeId" IS NOT NULL
    GROUP BY "finalNodeId"
  `;
  const threadCountMap = new Map(threadCounts.map((r) => [r.finalNodeId, Number(r.count)]));

  return c.json(workspace.taxonomyNodes.map((n) => ({ ...n, threadCount: threadCountMap.get(n.id) ?? 0 })));
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
      description: d.description,
      ...(d.instructions != null ? { instructions: d.instructions } : {}),
      ...(d.draftPrompt !== undefined ? { draftPrompt: d.draftPrompt } : {}),
      ...(d.examples !== undefined ? { examples: d.examples } : {}),
      ...(d.positionX !== undefined ? { positionX: d.positionX } : {}),
      ...(d.positionY !== undefined ? { positionY: d.positionY } : {}),
    },
    select: nodeSelect,
  });

  // A new folder changes routing outcomes — mark review threads re-sortable.
  await bumpTaxonomyChangedAt(workspaceId);

  return c.json({ ...node, threadCount: 0 }, 201);
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

    if (typeof rawBody === "object" && rawBody !== null && "isCatchAll" in rawBody) {
      return c.json({ error: "Cannot change isCatchAll" }, 400);
    }

    const existing = await db.taxonomyNode.findUnique({
      where: { id: nodeId },
      select: { id: true, workspaceId: true, isRoot: true },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json({ error: "Node not found" }, 404);
    }

    // Fields that affect embedding text: name (also invalidates descendants via
    // breadcrumb) and description. instructions/examples/position do not affect
    // the embedding — no invalidation needed for those.
    const embeddingInvalidation =
      d.name !== undefined || d.description !== undefined
        ? { embeddingTextHash: null, embeddingVector: [] as number[], embeddingUpdatedAt: null }
        : {};

    const updated = await db.taxonomyNode.update({
      where: { id: nodeId },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.instructions !== undefined ? { instructions: d.instructions } : {}),
        ...(d.draftPrompt !== undefined ? { draftPrompt: d.draftPrompt } : {}),
        ...(d.examples !== undefined ? { examples: d.examples } : {}),
        ...(d.positionX !== undefined ? { positionX: d.positionX } : {}),
        ...(d.positionY !== undefined ? { positionY: d.positionY } : {}),
        ...embeddingInvalidation,
      },
      select: nodeSelect,
    });

    // Name change: also invalidate descendants — their breadcrumb includes this node's name.
    if (d.name !== undefined) {
      const edges = await db.taxonomyEdge.findMany({
        where: { workspaceId },
        select: { id: true, sourceNodeId: true, targetNodeId: true },
      });
      const descendants = findDescendants(nodeId, edges);
      if (descendants.length > 0) {
        await db.taxonomyNode.updateMany({
          where: { id: { in: descendants } },
          data: { embeddingTextHash: null, embeddingVector: [] as number[], embeddingUpdatedAt: null },
        });
      }
    }

    // Only a name/description change alters routing (same condition as embedding
    // invalidation above). instructions/examples also feed LLM candidate
    // selection and could be added here later; position/draftPrompt never do.
    if (d.name !== undefined || d.description !== undefined) {
      await bumpTaxonomyChangedAt(workspaceId);
    }

    return c.json({ ...updated, threadCount: 0 });
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

    const body = await c.req.json().catch(() => ({})) as { moveToNodeId?: unknown };
    const moveToNodeId = typeof body.moveToNodeId === "string" ? body.moveToNodeId : null;

    const existing = await db.taxonomyNode.findUnique({
      where: { id: nodeId },
      select: {
        id: true,
        workspaceId: true,
        isRoot: true,
        isCatchAll: true,
        _count: { select: { outgoingEdges: true, incomingEdges: true, classifications: true } },
      },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json({ error: "Node not found" }, 404);
    }

    if (existing.isRoot) {
      return c.json({ error: "Cannot delete the Inbox node" }, 422);
    }

    if (existing.isCatchAll) {
      return c.json({ error: "Cannot delete the catch-all folder" }, 422);
    }

    if (existing._count.outgoingEdges > 0) {
      return c.json(
        { error: "Cannot delete a node that has outgoing edges" },
        422
      );
    }

    if (moveToNodeId) {
      const target = await db.taxonomyNode.findUnique({
        where: { id: moveToNodeId },
        select: { id: true, workspaceId: true },
      });
      if (!target || target.workspaceId !== workspaceId) {
        return c.json({ error: "Target node not found" }, 422);
      }
    }

    if (existing._count.classifications > 0) {
      await db.emailClassification.updateMany({
        where: { finalNodeId: nodeId },
        data: { finalNodeId: moveToNodeId ?? null },
      });
    }

    if (existing._count.incomingEdges > 0) {
      await db.taxonomyEdge.deleteMany({ where: { targetNodeId: nodeId } });
    }

    // References are deleted, not reassigned to moveToNodeId: a reference means
    // "this content belongs in THAT folder", and the folder is gone.
    await db.taxonomyNodeReference.deleteMany({ where: { nodeId } });

    await db.taxonomyNode.delete({ where: { id: nodeId } });

    // Removing a folder changes routing outcomes — mark review threads re-sortable.
    await bumpTaxonomyChangedAt(workspaceId);

    return c.json({ ok: true });
  }
);

export { taxonomyNodes as taxonomyNodesRoute };
