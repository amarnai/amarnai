import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { db, ensureInboxNode } from "@amarnai/db";

export async function POST(request: Request) {
  const stripe = getStripe();
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
    }
  } catch (err) {
    console.error(`[billing/webhook] handler error for ${event.type}:`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
  // In Stripe API v2025+, current_period_end moved to each subscription item.
  const item = subscription.items.data[0];
  if (item?.current_period_end) {
    return new Date(item.current_period_end * 1000);
  }
  return null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // In Stripe API v2025+, the subscription reference lives in invoice.parent.
  const parent = invoice.parent;
  if (parent?.type === "subscription_details") {
    const sub = parent.subscription_details?.subscription;
    return typeof sub === "string" ? sub : (sub?.id ?? null);
  }
  return null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const stripe = getStripe();
  const meta = session.metadata;
  if (!meta?.action || !meta.userId) return;

  const subscriptionId = session.subscription as string;
  const customerId = session.customer as string;

  // The initiating account must still exist before we provision. Otherwise the
  // create-action workspace insert violates the ownerUserId foreign key, this
  // handler throws, Stripe retries the event indefinitely, and a captured
  // payment is silently lost. If the user is gone (e.g. the account was deleted
  // between checkout and this event), log the Stripe identifiers for manual
  // reconciliation/refund and acknowledge the event so Stripe stops retrying.
  const initiatingUser = await db.user.findUnique({
    where: { id: meta.userId },
    select: { id: true },
  });
  if (!initiatingUser) {
    console.error(
      `[billing/webhook] orphaned checkout.session.completed: user ${meta.userId} not found for ` +
        `subscription ${subscriptionId} (customer ${customerId}); manual reconciliation required`
    );
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const currentPeriodEnd = subscriptionPeriodEnd(subscription);
  const trialEndsAt = subscription.trial_end
    ? new Date(subscription.trial_end * 1000)
    : null;
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const planValue = meta.plan === "pro" ? "PRO" : "BUSINESS";
  const cycleValue = meta.cycle === "annual" ? "ANNUAL" : "MONTHLY";

  if (meta.action === "upgrade") {
    if (!meta.workspaceId) return;
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
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
          paymentFailed: false,
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
  } else if (meta.action === "create") {
    const existing = await db.workspace.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      select: { id: true },
    });
    if (existing) return;

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
        currentPeriodEnd,
        members: { create: { userId: meta.userId, role: "OWNER" } },
      },
    });
    if (trialEndsAt !== null) {
      await db.user.update({ where: { id: meta.userId }, data: { trialUsed: true } });
    }
    await ensureInboxNode(workspace.id);
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
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const workspace = await db.workspace.findFirst({
    where: { stripeSubscriptionId: subscription.id },
    select: { id: true },
  });
  if (!workspace) return;

  // If the user cancels while still in trial, revoke access immediately rather
  // than waiting until the trial period ends.
  if (subscription.cancel_at_period_end && subscription.status === "trialing") {
    await db.$transaction([
      db.workspaceMember.deleteMany({
        where: { workspaceId: workspace.id, NOT: { role: "OWNER" } },
      }),
      db.workspace.update({
        where: { id: workspace.id },
        data: {
          plan: "FREE",
          stripeSubscriptionId: null,
          stripePriceId: null,
          billingCycle: null,
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          paymentFailed: false,
        },
      }),
    ]);
    await db.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorType: "SYSTEM",
        eventType: "workspace.plan.downgraded",
        entityType: "Workspace",
        entityId: workspace.id,
        metadata: { subscriptionId: subscription.id, reason: "trial_cancelled" },
      },
    });
    return;
  }

  await db.workspace.update({
    where: { id: workspace.id },
    data: {
      currentPeriodEnd: subscriptionPeriodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const workspace = await db.workspace.findFirst({
    where: { stripeSubscriptionId: subscription.id },
    select: { id: true },
  });
  if (!workspace) return;

  await db.$transaction([
    db.workspaceMember.deleteMany({
      where: { workspaceId: workspace.id, NOT: { role: "OWNER" } },
    }),
    db.workspace.update({
      where: { id: workspace.id },
      data: {
        plan: "FREE",
        stripeSubscriptionId: null,
        stripePriceId: null,
        billingCycle: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        paymentFailed: false,
      },
    }),
  ]);
  await db.auditLog.create({
    data: {
      workspaceId: workspace.id,
      actorType: "SYSTEM",
      eventType: "workspace.plan.downgraded",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: { subscriptionId: subscription.id },
    },
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const workspace = await db.workspace.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  if (!workspace) return;

  await db.workspace.update({ where: { id: workspace.id }, data: { paymentFailed: true } });
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const workspace = await db.workspace.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  if (!workspace) return;

  await db.workspace.update({
    where: { id: workspace.id },
    data: {
      paymentFailed: false,
      currentPeriodEnd: new Date(invoice.period_end * 1000),
    },
  });
}
