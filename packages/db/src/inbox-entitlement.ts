import { WorkspacePlan, BillingCycle } from "@prisma/client";
import { db } from "./client.js";

export interface InboxPlanCeiling {
  plan: WorkspacePlan;
  billingCycle: BillingCycle | null;
}

const PLAN_RANK: Record<WorkspacePlan, number> = {
  FREE: 0,
  PRO: 1,
  BUSINESS: 2,
};

// Pick the more generous of two ceilings: higher plan wins; within a plan,
// ANNUAL outranks MONTHLY (annual backfill caps are larger).
function maxCeiling(a: InboxPlanCeiling, b: InboxPlanCeiling): InboxPlanCeiling {
  if (PLAN_RANK[b.plan] > PLAN_RANK[a.plan]) return b;
  if (PLAN_RANK[b.plan] < PLAN_RANK[a.plan]) return a;
  return b.billingCycle === "ANNUAL" ? b : a;
}

const FREE_CEILING: InboxPlanCeiling = { plan: "FREE", billingCycle: null };

/**
 * Resolve the plan ceiling that sizes an inbox's pooled budget: the TOP plan
 * among all workspaces with an ACTIVE connection to this inbox. The same Gmail
 * may be connected to several workspaces (shared-mailbox feature); they share one
 * pooled budget sized by the most generous of them.
 *
 * Pass the connection's raw `gmailAddress` (OAuth returns each account's canonical
 * address, so sibling connections store the same string and match on equality).
 */
export async function getInboxPlanCeiling(emailAddress: string): Promise<InboxPlanCeiling> {
  const connections = await db.emailConnection.findMany({
    where: { emailAddress, status: "ACTIVE" },
    select: { workspace: { select: { plan: true, billingCycle: true } } },
  });

  if (connections.length === 0) return FREE_CEILING;

  return connections.reduce<InboxPlanCeiling>(
    (top, c) => maxCeiling(top, { plan: c.workspace.plan, billingCycle: c.workspace.billingCycle }),
    FREE_CEILING,
  );
}
