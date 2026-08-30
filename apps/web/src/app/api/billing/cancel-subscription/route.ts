import { NextResponse } from "next/server";
import { db } from "@aziru/db";
import { subscriptionPeriodEnd } from "@aziru/billing";
import { getStripe } from "@/lib/stripe";
import { resolveBillingUser, resolveBillingWorkspaceId } from "@/lib/billing-auth";
import { FREE_PLAN_RESET } from "@/lib/billing-mutations";

export async function POST(request: Request) {
  // Web session cookie or Bearer JWT (native mobile), with verify-before-pay.
  const authResult = await resolveBillingUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { userId } = authResult;

  // Mobile passes workspaceId explicitly; web falls back to the cookie selection.
  const body = await request.json().catch(() => ({}));
  const requestedWorkspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : undefined;
  const workspaceId = await resolveBillingWorkspaceId(userId, requestedWorkspaceId);
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      ownerUserId: true,
      stripeSubscriptionId: true,
      trialEndsAt: true,
    },
  });

  if (ws?.ownerUserId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!ws?.stripeSubscriptionId) {
    return NextResponse.json({ error: "No active subscription" }, { status: 404 });
  }

  const stripe = getStripe();
  const now = new Date();
  const isTrialing = ws.trialEndsAt !== null && ws.trialEndsAt > now;

  if (isTrialing) {
    await stripe.subscriptions.cancel(ws.stripeSubscriptionId);
    await db.$transaction([
      db.workspaceMember.deleteMany({
        where: { workspaceId, NOT: { role: "OWNER" } },
      }),
      db.workspace.update({ where: { id: workspaceId }, data: FREE_PLAN_RESET }),
    ]);
    return NextResponse.json({ immediateDowngrade: true });
  }

  const subscription = await stripe.subscriptions.update(ws.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await db.workspace.update({
    where: { id: workspaceId },
    data: { cancelAtPeriodEnd: true, currentPeriodEnd: subscriptionPeriodEnd(subscription) },
  });

  return NextResponse.json({ immediateDowngrade: false });
}
