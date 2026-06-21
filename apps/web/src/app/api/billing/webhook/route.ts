import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { db } from "@amarnai/db";
import { provisionFromCheckoutSession } from "@/lib/billing-provision";

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
        await provisionFromCheckoutSession(event.data.object as Stripe.Checkout.Session);
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
