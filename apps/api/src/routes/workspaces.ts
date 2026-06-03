import { Hono } from "hono";
import { db } from "@amarnai/db";
import type { AppEnv } from "../env.js";

const workspaces = new Hono<AppEnv>();

workspaces.get("/workspaces", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json([]);

  const result = await db.workspace.findMany({
    where: {
      members: { some: { userId } },
    },
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
