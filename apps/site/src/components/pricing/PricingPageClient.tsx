"use client";

import { PricingPlans, type PlanId, type BillingCycle } from "@aziru/ui";
import { ExtensionBanner } from "./ExtensionBanner";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.amarnai.com";

export function PricingPageClient() {
  function handleSelectPlan(plan: PlanId, cycle: BillingCycle) {
    const url = plan === "free"
      ? `${APP_URL}/sign-up`
      : `${APP_URL}/upgrade?plan=${plan}&cycle=${cycle}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <PricingPlans
      onSelectPlan={handleSelectPlan}
      beforeMatrix={<ExtensionBanner />}
    />
  );
}
