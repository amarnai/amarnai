import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import {
  TaxonomyTransferFileSchema,
  validateTaxonomyTransfer,
} from "@amarnai/shared";

const BODY_SIZE_LIMIT = 1_000_000; // 1 MB

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const taxonomyImport = new Hono();

taxonomyImport.post("/workspaces/:workspaceId/taxonomy-import", async (c) => {
  const params = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!params.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }
  const { workspaceId } = params.data;

  // Body size guard before parsing
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > BODY_SIZE_LIMIT) {
    return c.json({ error: "Request body too large" }, 413);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Schema parse (shape + version + size caps)
  const parsed = TaxonomyTransferFileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: "Invalid taxonomy file", issues: parsed.error.issues }, 400);
  }

  // Deep structural validation (graph validity, field rules, security)
  const validation = validateTaxonomyTransfer(parsed.data);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const file = validation.data;

  // Find the existing root node for this workspace (preserved through import)
  const existingRoot = await db.taxonomyNode.findFirst({
    where: { workspaceId, isRoot: true },
    select: { id: true },
  });
  if (!existingRoot) {
    return c.json({ error: "Workspace taxonomy is not initialized" }, 422);
  }

  const fileRoot = file.nodes.find((n) => n.isRoot)!;

  await db.$transaction(async (tx) => {
    // 1. Delete all edges in the workspace
    await tx.taxonomyEdge.deleteMany({ where: { workspaceId } });

    // 2. Clear all classification pointers (threads become unsorted)
    await tx.emailClassification.updateMany({
      where: { workspaceId, finalNodeId: { not: null } },
      data: { finalNodeId: null },
    });

    // 3. Delete all non-root nodes
    await tx.taxonomyNode.deleteMany({ where: { workspaceId, isRoot: false } });

    // 4. Update root node (name + position only; keep isRoot: true)
    await tx.taxonomyNode.update({
      where: { id: existingRoot.id },
      data: {
        name: fileRoot.name,
        positionX: fileRoot.positionX,
        positionY: fileRoot.positionY,
        // Clear stale embedding — root name may have changed
        embeddingTextHash: null,
        embeddingVector: [],
        embeddingUpdatedAt: null,
      },
    });

    // Build ref -> DB id map using a Map (never a plain object — prototype-safe)
    const refToId = new Map<string, string>();
    refToId.set(fileRoot.ref, existingRoot.id);

    // 5. Create non-root nodes, one by one, capturing each new id
    for (const node of file.nodes) {
      if (node.isRoot) continue;

      const created = await tx.taxonomyNode.create({
        data: {
          workspaceId,
          isRoot: false,
          name: node.name,
          description: node.description,
          instructions: node.instructions ?? null,
          draftPrompt: node.draftPrompt ?? null,
          examples: node.examples,
          positionX: node.positionX,
          positionY: node.positionY,
          // Embeddings left at defaults; recomputed on next sort
        },
        select: { id: true },
      });
      refToId.set(node.ref, created.id);
    }

    // 6. Create edges using the ref map
    for (const edge of file.edges) {
      const sourceNodeId = refToId.get(edge.sourceRef)!;
      const targetNodeId = refToId.get(edge.targetRef)!;
      await tx.taxonomyEdge.create({
        data: { workspaceId, sourceNodeId, targetNodeId },
      });
    }
  });

  return c.json({
    ok: true,
    nodeCount: file.nodes.length,
    edgeCount: file.edges.length,
  });
});

export { taxonomyImport as taxonomyImportRoute };
