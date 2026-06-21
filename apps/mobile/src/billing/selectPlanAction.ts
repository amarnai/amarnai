import type { PlanId, BillingCycle, BillingPlan, BillingCycleValue } from '@amarnai/shared';

// Routes a plan selection to the right billing operation:
//  - upgrade  -> create-checkout-session (browser, or paid->paid direct)
//  - change   -> change-plan (in-app downgrade or same-tier cycle switch)
//  - cancel   -> cancel-subscription (downgrade to Free, in-app)
//  - noop     -> already on this exact plan + cycle

export type PlanAction =
  | { kind: 'upgrade'; plan: Exclude<PlanId, 'free'>; cycle: BillingCycle }
  | { kind: 'change'; plan: Exclude<PlanId, 'free'>; cycle: BillingCycle }
  | { kind: 'cancel' }
  | { kind: 'noop' };

const TIER: Record<BillingPlan, number> = { FREE: 0, PRO: 1, BUSINESS: 2 };

export const PLAN_TO_BILLING: Record<PlanId, BillingPlan> = {
  free: 'FREE',
  pro: 'PRO',
  business: 'BUSINESS',
};

export function selectPlanAction(
  current: { plan: BillingPlan; cycle: BillingCycleValue | null },
  target: { plan: PlanId; cycle: BillingCycle },
): PlanAction {
  // Selecting Free means cancelling any active subscription.
  if (target.plan === 'free') {
    return current.plan === 'FREE' ? { kind: 'noop' } : { kind: 'cancel' };
  }

  const targetPlan = target.plan; // narrowed to 'pro' | 'business'
  const targetTier = TIER[PLAN_TO_BILLING[targetPlan]];
  const currentTier = TIER[current.plan];
  const targetCycle: BillingCycleValue = target.cycle === 'annual' ? 'ANNUAL' : 'MONTHLY';

  if (targetTier > currentTier) {
    return { kind: 'upgrade', plan: targetPlan, cycle: target.cycle };
  }
  if (targetTier < currentTier) {
    return { kind: 'change', plan: targetPlan, cycle: target.cycle };
  }
  // Same tier: only a billing-cycle switch is meaningful.
  if (current.cycle === targetCycle) {
    return { kind: 'noop' };
  }
  return { kind: 'change', plan: targetPlan, cycle: target.cycle };
}
