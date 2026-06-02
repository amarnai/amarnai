// Draft quota limits per plan (drafts generated per calendar month, per workspace).
// Keep in sync with the plan highlights in packages/ui/src/plans.ts.
export const DRAFT_LIMITS: Record<string, number> = {
  FREE: 3,
  PRO: 200,
  BUSINESS: 1000,
};

export function getDraftLimit(plan: string): number {
  return DRAFT_LIMITS[plan] ?? DRAFT_LIMITS["FREE"]!;
}

// Calendar-month window, UTC. All deployments use UTC so the window is unambiguous.

export function getDraftQuotaWindowStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function getDraftQuotaResetsAt(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
