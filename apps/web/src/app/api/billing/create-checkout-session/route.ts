import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@amarnai/db";
import { stripe, getPriceId } from "@/lib/stripe";

const bodySchema = z.object({
  workspaceId: z.string().optional(),
  plan: z.enum(["pro", "business"]),
  cycle: z.enum(["monthly", "annual"]),
  action: z.enum(["upgrade", "create"]),
  newWorkspaceName: z.string().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { plan, cycle, action, workspaceId, newWorkspaceName } = parsed.data;

  let offerTrial = true;

  if (action === "upgrade") {
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required for upgrade" }, { status: 400 });
    }
    const member = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (member?.role !== "OWNER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true, trialUsed: true, stripeSubscriptionId: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Paid plan upgrade (e.g. PRO → BUSINESS): update the existing subscription directly.
    if (workspace.plan !== "FREE") {
      const TIER: Record<string, number> = { FREE: 0, PRO: 1, BUSINESS: 2 };
      const planValue = plan === "pro" ? "PRO" : "BUSINESS";
      if ((TIER[planValue] ?? 0) <= (TIER[workspace.plan] ?? 0)) {
        return NextResponse.json({ error: "Cannot downgrade via this endpoint" }, { status: 400 });
      }
      if (!workspace.stripeSubscriptionId) {
        return NextResponse.json({ error: "No active subscription to upgrade" }, { status: 400 });
      }
      const priceId = getPriceId(plan, cycle);
      if (!priceId) {
        return NextResponse.json({ error: "Stripe price ID not configured" }, { status: 500 });
      }
      const subscription = await stripe.subscriptions.retrieve(workspace.stripeSubscriptionId);
      const item = subscription.items.data[0];
      const updated = await stripe.subscriptions.update(workspace.stripeSubscriptionId, {
        items: [{ id: item!.id, price: priceId }],
        proration_behavior: "create_prorations",
        cancel_at_period_end: false,
      });
      const updatedItem = updated.items.data[0];
      const currentPeriodEnd = updatedItem?.current_period_end
        ? new Date(updatedItem.current_period_end * 1000)
        : null;
      const cycleValue = cycle === "annual" ? "ANNUAL" : "MONTHLY";
      await db.workspace.update({
        where: { id: workspaceId },
        data: {
          plan: planValue,
          stripePriceId: priceId,
          billingCycle: cycleValue,
          trialEndsAt: null,
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
        },
      });
      await db.auditLog.create({
        data: {
          workspaceId,
          actorType: "USER",
          actorUserId: userId,
          eventType: "workspace.plan.upgraded",
          entityType: "Workspace",
          entityId: workspaceId,
          metadata: { plan, cycle, subscriptionId: workspace.stripeSubscriptionId },
        },
      });
      return NextResponse.json({ upgraded: true });
    }

    if (workspace.trialUsed) offerTrial = false;
  } else {
    if (!newWorkspaceName?.trim()) {
      return NextResponse.json({ error: "newWorkspaceName required for create" }, { status: 400 });
    }
    // Check if this user has already used a trial on any owned workspace
    const usedTrialBefore = await db.workspace.findFirst({
      where: { ownerUserId: userId, trialUsed: true },
      select: { id: true },
    });
    if (usedTrialBefore) offerTrial = false;
  }

  const priceId = getPriceId(plan, cycle);
  if (!priceId) {
    return NextResponse.json({ error: "Stripe price ID not configured" }, { status: 500 });
  }

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      ...(offerTrial ? { trial_period_days: 14 } : {}),
      metadata: {
        userId,
        workspaceId: workspaceId ?? "",
        action,
        plan,
        cycle,
        newWorkspaceName: newWorkspaceName ?? "",
      },
    },
    metadata: {
      userId,
      workspaceId: workspaceId ?? "",
      action,
      plan,
      cycle,
      newWorkspaceName: newWorkspaceName ?? "",
    },
    client_reference_id: userId,
    success_url: `${baseUrl}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/upgrade?plan=${plan}`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: checkoutSession.url });
}
