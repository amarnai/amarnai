import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@amarnai/db";
import { getStripe } from "@/lib/stripe";
import { getSelectedWorkspace } from "@/lib/workspace";

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

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getSelectedWorkspace(session.user.id);

  const ws = await db.workspace.findUnique({
    where: { id: workspace.id },
    select: { stripeCustomerId: true, ownerUserId: true },
  });

  if (ws?.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!ws?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }

  const baseUrl = process.env.AUTH_URL ?? "https://app.amarnai.com";

  await configurePortal();

  const portalSession = await getStripe().billingPortal.sessions.create({
    customer: ws.stripeCustomerId,
    return_url: `${baseUrl}/settings?cancelled=true`,
  });

  return NextResponse.json({ url: portalSession.url });
}
