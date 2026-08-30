import type { I18n } from "@lingui/core";
import { PLANS, PLAN_TO_BILLING, type BillingPlan } from "@aziru/shared";
import { trPlan } from "./planMessages.js";

/**
 * The marketing name for a stored plan value ("PRO" -> "Scribe"), localized at
 * the render edge. Shared so every surface naming a plan says the same thing;
 * falls back to the raw value if the two lists ever drift.
 */
export function billingPlanLabel(i18n: I18n, plan: BillingPlan | string): string {
  const marketing = PLANS.find((p) => PLAN_TO_BILLING[p.id] === plan);
  return marketing ? trPlan(i18n, marketing.name) : String(plan);
}
