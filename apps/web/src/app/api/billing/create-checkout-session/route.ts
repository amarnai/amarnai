import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@amarnai/db";
import { getStripe, getPriceId } from "@/lib/stripe";
import { resolveBillingUser } from "@/lib/billing-auth";
import { applyPaidPlanChange } from "@/lib/billing-mutations";
import { getReturnBaseUrl } from "@/lib/request-origin";

const bodySchema = z.object({
  workspaceId: z.string().optional(),
  plan: z.enum(["pro", "business"]),
  cycle: z.enum(["monthly", "annual"]),
  action: z.enum(["upgrade", "create"]),
  newWorkspaceName: z.string().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  // Web session cookie or Bearer JWT (native mobile), with verify-before-pay.
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

  const { plan, cycle, action, workspaceId, newWorkspaceName } = parsed.data;
  const stripe = getStripe();

  // `trialUsed` decides whether to offer the 14-day trial on first paid plan.
  const userRecord = await db.user.findUnique({
    where: { id: userId },
    select: { trialUsed: true },
  });
  if (!userRecord) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const offerTrial = !userRecord.trialUsed;

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
      select: { plan: true, stripeSubscriptionId: true },
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
      const result = await applyPaidPlanChange({
        workspaceId,
        userId,
        subscriptionId: workspace.stripeSubscriptionId,
        plan,
        cycle,
        eventType: "workspace.plan.upgraded",
        clearTrial: true,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ upgraded: true });
    }
  } else {
    if (!newWorkspaceName?.trim()) {
      return NextResponse.json({ error: "newWorkspaceName required for create" }, { status: 400 });
    }
  }

  const priceId = getPriceId(plan, cycle);
  if (!priceId) {
    return NextResponse.json({ error: "Stripe price ID not configured" }, { status: 500 });
  }

  // Return to the origin the request came from so the redirect is reachable by
  // the same browser (native mobile reaches a LAN host, not localhost/AUTH_URL).
  const baseUrl = getReturnBaseUrl(request);

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

  // Return the session id so native clients can confirm provisioning on return
  // from the browser (POST /api/billing/confirm-checkout) without depending on
  // the webhook having already arrived.
  return NextResponse.json({ url: checkoutSession.url, sessionId: checkoutSession.id });
}
