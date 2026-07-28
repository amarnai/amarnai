import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getStripe } from "@/lib/stripe";

/**
 * Hands a checkout started in the extension panel over to Stripe.
 *
 * The panel creates the Checkout session itself (it can call the billing routes
 * with its own token), but Stripe's success page is cookie-gated, so opening
 * Stripe directly would strand the user at the sign-in form on the way back.
 * Instead the panel opens the sign-in bridge pointed here: the session is minted
 * en route, and this redirects on to the Stripe URL.
 *
 * The session is re-read from Stripe rather than trusting a URL parameter, and
 * it must belong to the signed-in user, so a leaked link cannot send somebody
 * else to a checkout they did not start.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.redirect(new URL("/upgrade", request.url));
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId);
  } catch {
    return NextResponse.redirect(new URL("/upgrade", request.url));
  }

  if (session.client_reference_id !== user.id) {
    return NextResponse.redirect(new URL("/upgrade", request.url));
  }

  // Already paid (the user came back to a stale link): send them to the page
  // that provisions and confirms rather than back into a spent checkout.
  if (session.status === "complete") {
    return NextResponse.redirect(
      new URL(`/upgrade/success?session_id=${encodeURIComponent(sessionId)}`, request.url)
    );
  }

  if (session.status === "expired" || !session.url) {
    return NextResponse.redirect(new URL("/upgrade", request.url));
  }

  return NextResponse.redirect(session.url);
}
