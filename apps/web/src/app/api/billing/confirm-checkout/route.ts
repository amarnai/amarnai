import { NextResponse } from "next/server";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import { resolveBillingUser } from "@/lib/billing-auth";
import { provisionFromCheckoutSession } from "@/lib/billing-provision";

const bodySchema = z.object({ sessionId: z.string().min(1) });

/**
 * Confirm a completed Stripe Checkout session and provision the workspace.
 *
 * Native mobile clients can't use the web /upgrade/success page (no web cookie),
 * so after returning from the browser they call this with the session id (the
 * app received it from create-checkout-session). Idempotent with the webhook —
 * whichever runs first provisions; the other short-circuits.
 */
export async function POST(request: Request) {
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

  let session;
  try {
    session = await getStripe().checkout.sessions.retrieve(parsed.data.sessionId);
  } catch {
    return NextResponse.json({ error: "Checkout session not found" }, { status: 404 });
  }

  // The session must belong to the caller (set as client_reference_id at creation).
  if (session.client_reference_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Expired is final: Stripe will never complete this session, so telling the
  // client to keep trying leaves it retrying a dead id until its own timer gives
  // up. Reported as its own outcome so the caller drops the session rather than
  // holding it as if payment were still in progress.
  if (session.status === "expired") {
    return NextResponse.json({ expired: true });
  }

  // Not finished yet (e.g. the app returned before payment completed) — tell the
  // client to try again rather than treating it as failed.
  if (session.status !== "complete") {
    return NextResponse.json({ pending: true });
  }

  const result = await provisionFromCheckoutSession(session);
  if (!result) {
    return NextResponse.json({ error: "Could not provision from this session" }, { status: 400 });
  }

  return NextResponse.json({ provisioned: true, workspaceId: result.workspaceId, plan: result.plan });
}
