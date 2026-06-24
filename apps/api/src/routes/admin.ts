import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import type { AppEnv } from "../env.js";

const admin = new Hono<AppEnv>();

const PlanBody = z.object({
  plan: z.enum(["FREE", "PRO", "BUSINESS"]),
});

admin.patch("/admin/workspaces/:workspaceId/plan", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const user = await db.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } });
  if (!user?.isSystemAdmin) return c.json({ error: "Forbidden" }, 403);

  const workspaceId = c.req.param("workspaceId");
  const body = PlanBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid plan" }, 400);

  const workspace = await db.workspace.update({
    where: { id: workspaceId },
    data: { plan: body.data.plan },
    select: { id: true, name: true, plan: true },
  });

  return c.json(workspace);
});

export { admin as adminRoute };
