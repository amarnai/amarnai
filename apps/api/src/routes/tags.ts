import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const tags = new Hono();

tags.get("/workspaces/:workspaceId/tags", async (c) => {
  const parsed = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: {
      tags: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          color: true,
          source: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json(workspace.tags);
});

export { tags as tagsRoute };
