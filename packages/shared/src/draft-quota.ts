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

// Short, UTC-stable display of a quota reset date (e.g. "Jul 1"). Shared by the
// web, ui, and mobile draft-quota copy so the format never drifts between them.
export function formatQuotaResetDate(resetsAt: string): string {
  return new Date(resetsAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}
