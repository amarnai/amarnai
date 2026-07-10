import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import type { AppEnv } from "../env.js";

const admin = new Hono<AppEnv>();

const PlanBody = z.object({
  plan: z.enum(["FREE", "PRO", "BUSINESS"]),
});

const PLAN_RANK: Record<"FREE" | "PRO" | "BUSINESS", number> = { FREE: 0, PRO: 1, BUSINESS: 2 };

admin.patch("/admin/workspaces/:workspaceId/plan", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const user = await db.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } });
  if (!user?.isSystemAdmin) return c.json({ error: "Forbidden" }, 403);

  const workspaceId = c.req.param("workspaceId");
  const body = PlanBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid plan" }, 400);

  const existing = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  if (!existing) return c.json({ error: "Workspace not found" }, 404);

  const newPlan = body.data.plan;
  // An upgrade raises the backfill cap, so re-scan the inbox up to the new ceiling —
  // and clear any stale cap-reached flag from the lower tier. Mirrors the paid
  // checkout path (billing-provision). The worker re-enqueues on backfillStatus
  // PENDING; re-ingesting stored threads is idempotent. No-op without a connected
  // inbox. Downgrades leave the existing backfill state untouched.
  const isUpgrade = PLAN_RANK[newPlan] > PLAN_RANK[existing.plan];

  const [workspace] = await db.$transaction([
    db.workspace.update({
      where: { id: workspaceId },
      data: { plan: newPlan },
      select: { id: true, name: true, plan: true },
    }),
    ...(isUpgrade
      ? [
          db.providerSyncState.updateMany({
            where: { emailAccount: { workspaceId } },
            data: {
              backfillStatus: "PENDING",
              backfillStartedAt: null,
              backfillPageToken: null,
              backfillProcessedCount: 0,
              backfillTotalEstimate: 0,
              backfillSkipped: 0,
              backfillGeneration: { increment: 1 },
              backfillCapReached: false,
              backfillBeyondCount: 0,
              backfillLimitState: "NONE",
            },
          }),
        ]
      : []),
  ]);

  // Audit the admin override (previously unaudited). Distinct eventType from the
  // self-serve billing changes so admin actions are filterable.
  await db.auditLog.create({
    data: {
      workspaceId,
      actorType: "USER",
      actorUserId: userId,
      eventType: "workspace.plan.admin_set",
      entityType: "Workspace",
      entityId: workspaceId,
      metadata: { from: existing.plan, to: newPlan },
    },
  });

  return c.json(workspace);
});

export { admin as adminRoute };
