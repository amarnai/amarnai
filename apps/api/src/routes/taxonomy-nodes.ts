import { Hono } from "hono";
import { z } from "zod";
import { db } from "@genizor/db";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

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
        select: {
          id: true,
          parentId: true,
          kind: true,
          name: true,
          description: true,
          positionX: true,
          positionY: true,
          syncToGmail: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json(workspace.taxonomyNodes);
});

export { taxonomyNodes as taxonomyNodesRoute };
