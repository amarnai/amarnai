import Stripe from "stripe";

// Shared Stripe client for the server packages that need it (web, api, worker).
// apps/web/src/lib/stripe.ts re-exports getStripe from here and keeps its own
// price-ID lookup. Pin the API version to the same value across the codebase so a
// dependency bump never silently changes request/response shapes.
const STRIPE_API_VERSION = "2026-05-27.dahlia";

let _stripe: Stripe | undefined;

/** Whether Stripe is configured. Self-host deployments may run without billing. */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
    });
  }
  return _stripe;
}
