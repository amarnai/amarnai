"use client";

import { PricingPlans, type PlanId, type BillingCycle } from "@amarnai/ui";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export function PricingPageClient() {
  function handleSelectPlan(plan: PlanId, cycle: BillingCycle) {
    const url = plan === "free"
      ? `${APP_URL}/sign-up`
      : `${APP_URL}/upgrade?plan=${plan}&cycle=${cycle}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return <PricingPlans onSelectPlan={handleSelectPlan} />;
}
