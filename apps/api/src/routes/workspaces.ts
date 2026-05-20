import { Hono } from "hono";
import { db } from "@amarnai/db";

const workspaces = new Hono();

workspaces.get("/workspaces", async (c) => {
  const result = await db.workspace.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      owner: {
        select: { id: true, email: true, name: true },
      },
      members: {
        select: {
          id: true,
          role: true,
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      },
    },
  });
  return c.json(result);
});

export { workspaces as workspacesRoute };
