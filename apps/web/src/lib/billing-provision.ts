import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { db, ensureInboxTaxonomy } from "@amarnai/db";

export interface ProvisionResult {
  workspaceId: string;
  plan: "PRO" | "BUSINESS";
}

function periodEnd(subscription: Stripe.Subscription): Date | null {
  // In Stripe API v2025+, current_period_end lives on each subscription item.
  const item = subscription.items.data[0];
  return item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
}

/**
 * Provision a workspace from a completed Stripe Checkout session.
 *
 * Shared by the Stripe webhook (async, server-to-server) and the mobile
 * confirm-checkout endpoint (the native app has no web cookie, so it cannot use
 * the web /upgrade/success page and instead confirms on return). Idempotent: an
 * already-provisioned upgrade/create short-circuits, so running from both the
 * webhook and the app is safe.
 *
 * Returns null when the session metadata is incomplete or the initiating user no
 * longer exists (orphaned payment — logged for manual reconciliation).
 */
export async function provisionFromCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<ProvisionResult | null> {
  const meta = session.metadata;
  if (!meta?.action || !meta.userId) return null;

  const subscriptionId = session.subscription as string;
  const customerId = session.customer as string;

  // The initiating account must still exist before we provision; otherwise the
  // create insert violates the ownerUserId FK (and the webhook would retry
  // forever). Acknowledge + log for manual reconciliation instead.
  const initiatingUser = await db.user.findUnique({
    where: { id: meta.userId },
    select: { id: true },
  });
  if (!initiatingUser) {
    console.error(
      `[billing/provision] orphaned checkout: user ${meta.userId} not found for ` +
        `subscription ${subscriptionId} (customer ${customerId}); manual reconciliation required`,
    );
    return null;
  }

  const planValue = meta.plan === "pro" ? "PRO" : "BUSINESS";
  const cycleValue = meta.cycle === "annual" ? "ANNUAL" : "MONTHLY";

  if (meta.action === "upgrade") {
    if (!meta.workspaceId) return null;

    // Idempotency: skip if this subscription already provisioned this workspace.
    const existing = await db.workspace.findUnique({
      where: { id: meta.workspaceId },
      select: { stripeSubscriptionId: true, plan: true },
    });
    if (existing?.stripeSubscriptionId === subscriptionId && existing.plan === planValue) {
      return { workspaceId: meta.workspaceId, plan: planValue };
    }

    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
    const priceId = subscription.items.data[0]?.price.id ?? null;

    await db.$transaction([
      db.workspace.update({
        where: { id: meta.workspaceId },
        data: {
          plan: planValue,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: priceId,
          billingCycle: cycleValue,
          trialEndsAt,
          currentPeriodEnd: periodEnd(subscription),
          cancelAtPeriodEnd: false,
          paymentFailed: false,
        },
      }),
      // Reset the backfill so it re-scans up to the new (higher) plan cap and,
      // for Free -> paid, drops the 30-day window. The worker's sync scheduler
      // re-enqueues a backfill whenever the status is PENDING. Re-ingesting
      // already-stored threads is idempotent (upsert by provider thread id).
      // No-op when the workspace has no connected inbox yet.
      db.providerSyncState.updateMany({
        where: { emailAccount: { workspaceId: meta.workspaceId } },
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
        },
      }),
      ...(trialEndsAt !== null
        ? [db.user.update({ where: { id: meta.userId }, data: { trialUsed: true } })]
        : []),
    ]);
    await db.auditLog.create({
      data: {
        workspaceId: meta.workspaceId,
        actorType: "USER",
        actorUserId: meta.userId,
        eventType: "workspace.plan.upgraded",
        entityType: "Workspace",
        entityId: meta.workspaceId,
        metadata: { plan: meta.plan, cycle: meta.cycle, subscriptionId },
      },
    });
    return { workspaceId: meta.workspaceId, plan: planValue };
  }

  // action === "create"
  const existing = await db.workspace.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  if (existing) return { workspaceId: existing.id, plan: planValue };

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
  const priceId = subscription.items.data[0]?.price.id ?? null;

  const workspace = await db.workspace.create({
    data: {
      name: meta.newWorkspaceName || "My Workspace",
      ownerUserId: meta.userId,
      plan: planValue,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      billingCycle: cycleValue,
      trialEndsAt,
      currentPeriodEnd: periodEnd(subscription),
      members: { create: { userId: meta.userId, role: "OWNER" } },
    },
  });
  if (trialEndsAt !== null) {
    await db.user.update({ where: { id: meta.userId }, data: { trialUsed: true } });
  }
  await ensureInboxTaxonomy(workspace.id);
  await db.auditLog.create({
    data: {
      workspaceId: workspace.id,
      actorType: "USER",
      actorUserId: meta.userId,
      eventType: "workspace.created.paid",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: { plan: meta.plan, cycle: meta.cycle, subscriptionId },
    },
  });
  return { workspaceId: workspace.id, plan: planValue };
}
