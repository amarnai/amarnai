import { NextResponse } from "next/server";
import { db } from "@aziru/db";
import { getStripe } from "@/lib/stripe";
import { resolveBillingUser, resolveBillingWorkspaceId } from "@/lib/billing-auth";
import { getReturnBaseUrl } from "@/lib/request-origin";

// Configure the Stripe portal on first open per process — idempotent on Stripe's side.
let _portalConfigured = false;

async function configurePortal(): Promise<void> {
  if (_portalConfigured) return;
  const stripe = getStripe();
  try {
    const { data: configs } = await stripe.billingPortal.configurations.list({ limit: 10 });
    const config = configs.find((c) => c.is_default) ?? configs[0];
    if (config) {
      await stripe.billingPortal.configurations.update(config.id, {
        business_profile: {
          headline: "Amarnai",
        },
        features: {
          subscription_cancel: {
            cancellation_reason: { enabled: false },
          },
        },
      });
    }
    _portalConfigured = true;
  } catch {
    // Non-fatal — proceed with whatever the portal is currently configured to show.
  }
}

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
    select: { stripeCustomerId: true, ownerUserId: true },
  });

  if (ws?.ownerUserId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!ws?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }

  const baseUrl = getReturnBaseUrl(request);

  await configurePortal();

  try {
    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: ws.stripeCustomerId,
      return_url: `${baseUrl}/settings?cancelled=true`,
    });
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    // The stored customer can be absent in the active Stripe account (e.g. a dev
    // DB seeded against a different account, or wiped test data). Surface a clean
    // message instead of a 500 so the client can guide the user to reconcile.
    if ((err as { code?: string }).code === "resource_missing") {
      return NextResponse.json(
        { error: "Billing account is out of sync with Stripe. Reset the workspace or re-subscribe to fix this." },
        { status: 409 },
      );
    }
    throw err;
  }
}
