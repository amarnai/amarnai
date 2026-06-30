// Initial historical backfill caps per plan and billing cycle.
//
// Single source of truth for backfill volume. The worker job, API routes, and
// the marketing pricing table (packages/ui/src/plans.ts) all derive from here
// so the numbers are never duplicated.

/** Resolved backfill cap for one plan + billing cycle. */
export interface BackfillCap {
  /** Maximum number of historical threads the initial backfill will sort. */
  maxThreads: number;
  /** Day window to scan back from now, or null to scan full history. */
  windowDays: number | null;
}

/** Caps for both billing cycles of a single plan. */
export interface PlanBackfillCaps {
  monthly: BackfillCap;
  annual: BackfillCap;
}

export const BACKFILL_CAPS: Record<string, PlanBackfillCaps> = {
  FREE: {
    monthly: { maxThreads: 500, windowDays: null },
    annual:  { maxThreads: 500, windowDays: null },
  },
  PRO: {
    monthly: { maxThreads: 10_000, windowDays: null },
    annual:  { maxThreads: 50_000, windowDays: null },
  },
  BUSINESS: {
    monthly: { maxThreads: 75_000, windowDays: null },
    annual:  { maxThreads: 250_000, windowDays: null },
  },
};

/**
 * Resolve the backfill cap for a plan + billing cycle.
 *
 * - Unknown plans fall back to FREE.
 * - A null or unknown billing cycle on a paid plan falls back to the smaller
 *   monthly cap (only "ANNUAL" selects the larger annual cap).
 */
export function getBackfillCap(plan: string, billingCycle: string | null): BackfillCap {
  const planCaps = BACKFILL_CAPS[plan] ?? BACKFILL_CAPS["FREE"]!;
  return billingCycle === "ANNUAL" ? planCaps.annual : planCaps.monthly;
}
