// Machine-readable billing display state, shared between the web settings page
// and the mobile Plan screen. Dates are ISO strings so the shape survives JSON
// transport to native clients.

export type BillingPlan = "FREE" | "PRO" | "BUSINESS";
export type BillingCycleValue = "MONTHLY" | "ANNUAL";

export interface BillingMember {
  name: string | null;
  email: string;
}

export interface BillingState {
  plan: BillingPlan;
  billingCycle: BillingCycleValue | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  paymentFailed: boolean;
  hasSubscription: boolean;
  /** Whether the requesting user owns the workspace (gates management actions). */
  isOwner: boolean;
  collaboratorCount: number;
  collaboratorLimit: number;
  /** Non-owner members who would lose access if the subscription is cancelled. */
  membersToRemoveOnCancel: BillingMember[];
  /** Whether the user has already consumed their one free trial. */
  trialUsed: boolean;
}
