"use client";

import { PricingPlans, type PlanId, type BillingCycle } from "@amarnai/ui";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export function PricingPageClient() {
  function handleSelectPlan(plan: PlanId, cycle: BillingCycle) {
    if (plan === "free") {
      window.location.href = `${APP_URL}/sign-up`;
    } else {
      window.location.href = `${APP_URL}/upgrade?plan=${plan}&cycle=${cycle}`;
    }
  }

  return <PricingPlans onSelectPlan={handleSelectPlan} />;
}
