import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@amarnai/db";
import { stripe } from "@/lib/stripe";
import { getSelectedWorkspace } from "@/lib/workspace";

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

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: ws.stripeCustomerId,
    return_url: `${baseUrl}/settings`,
  });

  return NextResponse.json({ url: portalSession.url });
}
