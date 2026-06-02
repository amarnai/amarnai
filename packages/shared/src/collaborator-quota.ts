// Collaborator limits per plan (non-owner members allowed per workspace).
// Keep in sync with the plan highlights in packages/ui/src/plans.ts.
export const COLLABORATOR_LIMITS: Record<string, number> = {
  FREE: 0,
  PRO: 10,
  BUSINESS: 25,
};

export function getCollaboratorLimit(plan: string): number {
  return COLLABORATOR_LIMITS[plan] ?? COLLABORATOR_LIMITS["FREE"]!;
}
