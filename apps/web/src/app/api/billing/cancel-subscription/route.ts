import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@amarnai/db";
import { getStripe } from "@/lib/stripe";
import { getSelectedWorkspace } from "@/lib/workspace";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getSelectedWorkspace(session.user.id);

  const ws = await db.workspace.findUnique({
    where: { id: workspace.id },
    select: {
      ownerUserId: true,
      stripeSubscriptionId: true,
      trialEndsAt: true,
    },
  });

  if (ws?.ownerUserId !== session.user.id) {
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
    return NextResponse.json({ immediateDowngrade: true });
  }

  const subscription = await stripe.subscriptions.update(ws.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  const item = subscription.items.data[0];
  const currentPeriodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  await db.workspace.update({
    where: { id: workspace.id },
    data: { cancelAtPeriodEnd: true, currentPeriodEnd },
  });

  return NextResponse.json({ immediateDowngrade: false });
}
