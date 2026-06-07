import Stripe from "stripe";
import type { PlanId, BillingCycle } from "@amarnai/ui";

let _stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-05-27.dahlia",
    });
  }
  return _stripe;
}

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
