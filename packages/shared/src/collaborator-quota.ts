// Collaborator limits per plan (non-owner members allowed per workspace).
// These are ADDITIONAL seats beyond the owner, so total headcount is this + 1:
// FREE 1 total (owner only), PRO 2 total (you + 1 teammate), BUSINESS 3 total.
// Keep in sync with the plan highlights in packages/ui/src/plans.ts.
export const COLLABORATOR_LIMITS: Record<string, number> = {
  FREE: 0,
  PRO: 1,
  BUSINESS: 2,
};

export function getCollaboratorLimit(plan: string): number {
  return COLLABORATOR_LIMITS[plan] ?? COLLABORATOR_LIMITS["FREE"]!;
}
