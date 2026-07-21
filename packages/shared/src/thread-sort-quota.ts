// Thread-sort limits per plan (distinct threads classified per calendar month, per workspace).
// Keep in sync with the plan highlights in packages/ui/src/plans.ts.
export const THREAD_SORT_LIMITS: Record<string, number> = {
  FREE: 50,
  PRO: 5000,
  BUSINESS: 10000,
};

export function getThreadSortLimit(plan: string): number {
  return THREAD_SORT_LIMITS[plan] ?? THREAD_SORT_LIMITS["FREE"]!;
}
