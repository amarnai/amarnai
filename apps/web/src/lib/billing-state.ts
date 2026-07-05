import { db, hasTrialClaim } from "@amarnai/db";
import { subscriptionPeriodEnd } from "@amarnai/billing";
import { getStripe } from "@/lib/stripe";
import { getCollaboratorLimit } from "@amarnai/shared";
import type { BillingState, BillingPlan, BillingCycleValue } from "@amarnai/shared";
import { FREE_PLAN_RESET } from "@/lib/billing-mutations";

const billingSelect = {
  plan: true,
  billingCycle: true,
  currentPeriodEnd: true,
  trialEndsAt: true,
  cancelAtPeriodEnd: true,
  paymentFailed: true,
  stripeSubscriptionId: true,
  ownerUserId: true,
} as const;

/**
 * Assemble the billing display state for a workspace, shared by the web settings
 * page and the mobile-facing GET /api/billing/state endpoint.
 *
 * When `forceReconcile` is set (e.g. on portal return), or whenever the workspace
 * is on a paid plan with no pending cancellation, the subscription is reconciled
 * with Stripe so the state is accurate even before the webhook arrives. Mirrors
 * the webhook's cancellation handling.
 */
export async function assembleBillingState(
  userId: string,
  workspaceId: string,
  opts: { forceReconcile?: boolean } = {},
): Promise<BillingState> {
  let billing = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: billingSelect,
  });
  if (!billing) {
    throw new Error("Workspace not found");
  }

  const needsSync =
    !!billing.stripeSubscriptionId &&
    (opts.forceReconcile || (billing.plan !== "FREE" && !billing.cancelAtPeriodEnd));

  if (needsSync && billing.stripeSubscriptionId) {
    try {
      const subscription = await getStripe().subscriptions.retrieve(billing.stripeSubscriptionId);

      if (
        subscription.status === "canceled" ||
        (subscription.cancel_at_period_end && subscription.status === "trialing")
      ) {
        // Subscription deleted on Stripe, or a trial was cancelled — revoke access
        // immediately (mirrors handleSubscriptionDeleted / webhook trial logic).
        await db.$transaction([
          db.workspaceMember.deleteMany({
            where: { workspaceId, NOT: { role: "OWNER" } },
          }),
          db.workspace.update({ where: { id: workspaceId }, data: FREE_PLAN_RESET }),
        ]);
      } else if (subscription.cancel_at_period_end) {
        await db.workspace.update({
          where: { id: workspaceId },
          data: { cancelAtPeriodEnd: true, currentPeriodEnd: subscriptionPeriodEnd(subscription) },
        });
      }

      billing = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: billingSelect,
      });
    } catch {
      // Non-fatal — fall back to whatever state is already in the DB.
    }
  }
  if (!billing) {
    throw new Error("Workspace not found");
  }

  const [members, owner] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId, NOT: { role: "OWNER" } },
      select: { user: { select: { name: true, email: true } } },
    }),
    db.user.findUnique({ where: { id: userId }, select: { trialUsed: true, email: true } }),
  ]);

  // A durable trial claim on the owner's email counts as consumed even if the
  // denormalized flag is not yet set (e.g. a card-denied trial), so the UI stops
  // advertising a trial they can't get.
  const trialConsumed = owner
    ? owner.trialUsed || (await hasTrialClaim(owner.email))
    : false;

  const plan = billing.plan as BillingPlan;
  return {
    plan,
    billingCycle: (billing.billingCycle as BillingCycleValue | null) ?? null,
    currentPeriodEnd: billing.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: billing.trialEndsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
    paymentFailed: billing.paymentFailed,
    hasSubscription: !!billing.stripeSubscriptionId,
    isOwner: billing.ownerUserId === userId,
    collaboratorCount: members.length,
    collaboratorLimit: getCollaboratorLimit(plan),
    membersToRemoveOnCancel: members.map((m) => ({ name: m.user.name, email: m.user.email })),
    trialUsed: trialConsumed,
  };
}
