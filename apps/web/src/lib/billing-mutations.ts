import { db } from "@amarnai/db";
import { getStripe, getPriceId } from "@/lib/stripe";
import type { PlanId, BillingCycle } from "@amarnai/shared";

// Workspace fields that revert a workspace to the free plan, clearing all Stripe
// state. Shared by cancel-subscription (immediate trial cancel) and the
// state-reconciler (Stripe-side cancellation mirrored locally).
export const FREE_PLAN_RESET = {
  plan: "FREE",
  stripeSubscriptionId: null,
  stripePriceId: null,
  billingCycle: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  paymentFailed: false,
} as const;

export type PlanChangeResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Move an existing paid subscription to a different paid price, applying
 * prorations. Shared by the checkout route (paid -> higher tier upgrade) and the
 * change-plan route (paid -> lower tier / cycle switch); the only differences are
 * the audit event name and whether to clear a leftover trial date, so those are
 * parameters. Does not collect new payment — Stripe prorates against the saved
 * payment method.
 */
export async function applyPaidPlanChange(opts: {
  workspaceId: string;
  userId: string;
  subscriptionId: string;
  plan: Exclude<PlanId, "free">;
  cycle: BillingCycle;
  eventType: string;
  clearTrial?: boolean;
}): Promise<PlanChangeResult> {
  const priceId = getPriceId(opts.plan, opts.cycle);
  if (!priceId) {
    return { ok: false, status: 500, error: "Stripe price ID not configured" };
  }

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(opts.subscriptionId);
  const item = subscription.items.data[0];
  const updated = await stripe.subscriptions.update(opts.subscriptionId, {
    items: [{ id: item!.id, price: priceId }],
    proration_behavior: "create_prorations",
    cancel_at_period_end: false,
  });
  const updatedItem = updated.items.data[0];
  const currentPeriodEnd = updatedItem?.current_period_end
    ? new Date(updatedItem.current_period_end * 1000)
    : null;

  await db.workspace.update({
    where: { id: opts.workspaceId },
    data: {
      plan: opts.plan === "pro" ? "PRO" : "BUSINESS",
      stripePriceId: priceId,
      billingCycle: opts.cycle === "annual" ? "ANNUAL" : "MONTHLY",
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      ...(opts.clearTrial ? { trialEndsAt: null } : {}),
    },
  });

  await db.auditLog.create({
    data: {
      workspaceId: opts.workspaceId,
      actorType: "USER",
      actorUserId: opts.userId,
      eventType: opts.eventType,
      entityType: "Workspace",
      entityId: opts.workspaceId,
      metadata: { plan: opts.plan, cycle: opts.cycle, subscriptionId: opts.subscriptionId },
    },
  });

  return { ok: true };
}
