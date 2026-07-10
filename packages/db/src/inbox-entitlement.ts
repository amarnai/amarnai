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

/**
 * Backfill-specific ceiling. Identical to getInboxPlanCeiling EXCEPT that, when
 * `requirePayment` is true, a paid-plan connection whose workspace has not yet made
 * a first successful payment (`firstPaidAt == null` — i.e. FREE or still trialing)
 * contributes only the FREE ceiling. This gates the large plan backfill caps behind
 * the first payment while leaving sorts/drafts/seats at plan level during the trial.
 *
 * The clamp is applied PER CONNECTION before pooling, so a shared inbox with a
 * paid-PRO workspace and a trialing-BUSINESS workspace pools at PRO, not BUSINESS.
 */
export async function getInboxBackfillCeiling(
  emailAddress: string,
  opts: { requirePayment: boolean },
): Promise<InboxPlanCeiling> {
  const connections = await db.emailConnection.findMany({
    where: { emailAddress, status: "ACTIVE" },
    select: { workspace: { select: { plan: true, billingCycle: true, firstPaidAt: true } } },
  });

  if (connections.length === 0) return FREE_CEILING;

  return connections.reduce<InboxPlanCeiling>((top, c) => {
    const w = c.workspace;
    const gated = opts.requirePayment && w.plan !== "FREE" && w.firstPaidAt == null;
    const contribution: InboxPlanCeiling = gated
      ? FREE_CEILING
      : { plan: w.plan, billingCycle: w.billingCycle };
    return maxCeiling(top, contribution);
  }, FREE_CEILING);
}
