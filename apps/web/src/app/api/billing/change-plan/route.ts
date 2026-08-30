import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@aziru/db";
import { getCollaboratorLimit } from "@aziru/shared";
import { resolveBillingUser, resolveBillingWorkspaceId } from "@/lib/billing-auth";
import { applyPaidPlanChange } from "@/lib/billing-mutations";

const bodySchema = z.object({
  workspaceId: z.string().optional(),
  plan: z.enum(["pro", "business"]),
  cycle: z.enum(["monthly", "annual"]),
});

const TIER: Record<string, number> = { FREE: 0, PRO: 1, BUSINESS: 2 };

/**
 * In-app plan change for paid -> lower-or-equal paid tiers (e.g. Business -> Pro,
 * or a same-tier billing-cycle switch). No payment is collected, so this stays
 * in-app rather than handing off to the browser. Upgrades to a higher tier go
 * through create-checkout-session; downgrades to Free go through cancel-subscription.
 */
export async function POST(request: Request) {
  const authResult = await resolveBillingUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { userId } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { plan, cycle } = parsed.data;

  const workspaceId = await resolveBillingWorkspaceId(userId, parsed.data.workspaceId);
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      plan: true,
      ownerUserId: true,
      stripeSubscriptionId: true,
      billingCycle: true,
    },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  if (workspace.ownerUserId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (workspace.plan === "FREE" || !workspace.stripeSubscriptionId) {
    return NextResponse.json({ error: "No active subscription to change" }, { status: 400 });
  }

  const planValue = plan === "pro" ? "PRO" : "BUSINESS";
  const cycleValue = cycle === "annual" ? "ANNUAL" : "MONTHLY";

  // Upgrades belong on the checkout endpoint (proration may collect payment).
  if ((TIER[planValue] ?? 0) > (TIER[workspace.plan] ?? 0)) {
    return NextResponse.json({ error: "Use checkout to upgrade" }, { status: 400 });
  }
  // No-op: same tier and cycle.
  if (planValue === workspace.plan && cycleValue === workspace.billingCycle) {
    return NextResponse.json({ error: "Already on this plan" }, { status: 400 });
  }

  // Collaborator-limit guard: block the downgrade while over the lower plan's cap
  // rather than silently removing collaborators. Surface who is over the limit so
  // the client can tell the owner what to do.
  const newLimit = getCollaboratorLimit(planValue);
  const members = await db.workspaceMember.findMany({
    where: { workspaceId, NOT: { role: "OWNER" } },
    select: { user: { select: { name: true, email: true } } },
  });
  if (members.length > newLimit) {
    return NextResponse.json(
      {
        error: `This plan allows ${newLimit} collaborator${newLimit === 1 ? "" : "s"}. Remove ${members.length - newLimit} before downgrading.`,
        membersToRemove: members.map((m) => ({ name: m.user.name, email: m.user.email })),
      },
      { status: 409 },
    );
  }

  const result = await applyPaidPlanChange({
    workspaceId,
    userId,
    subscriptionId: workspace.stripeSubscriptionId,
    plan,
    cycle,
    eventType: "workspace.plan.changed",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ changed: true });
}
