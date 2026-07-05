import type { PlanId, BillingCycle } from "@amarnai/ui";

// The Stripe client singleton lives in @amarnai/billing so the api and worker
// packages can share it. Re-exported here so existing `@/lib/stripe` imports (and
// their test mocks) keep working unchanged. Price-ID lookup stays web-only.
export { getStripe } from "@amarnai/billing";

const PRICE_IDS: Record<PlanId, Record<BillingCycle, string | undefined>> = {
  free: { monthly: undefined, annual: undefined },
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
  },
  business: {
    monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
    annual: process.env.STRIPE_PRICE_BUSINESS_ANNUAL,
  },
};

export function getPriceId(plan: PlanId, cycle: BillingCycle): string | null {
  return PRICE_IDS[plan]?.[cycle] ?? null;
}
