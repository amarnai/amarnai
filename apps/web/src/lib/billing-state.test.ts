import { vi, describe, it, expect, beforeEach } from "vitest";

const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
}));

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
    workspaceMember: { findMany: vi.fn(), deleteMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  hasTrialClaim: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({ getStripe: () => mockStripe }));

import { db, hasTrialClaim } from "@amarnai/db";
import { assembleBillingState } from "@/lib/billing-state";

const USER_ID = "user-1";
const WS_ID = "ws-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: true, email: "user@example.com" } as never);
  vi.mocked(db.workspaceMember.findMany).mockResolvedValue([] as never);
  vi.mocked(hasTrialClaim).mockResolvedValue(false);
});

describe("assembleBillingState", () => {
  it("maps a Free workspace without touching Stripe", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "FREE",
      billingCycle: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      paymentFailed: false,
      stripeSubscriptionId: null,
      ownerUserId: USER_ID,
    } as never);

    const state = await assembleBillingState(USER_ID, WS_ID);

    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(state.plan).toBe("FREE");
    expect(state.hasSubscription).toBe(false);
    expect(state.isOwner).toBe(true);
    expect(state.collaboratorLimit).toBe(0);
    expect(state.trialUsed).toBe(true);
  });

  it("returns serializable ISO dates and the plan's collaborator limit for a paid workspace", async () => {
    const periodEnd = new Date("2026-07-01T00:00:00.000Z");
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "PRO",
      billingCycle: "MONTHLY",
      currentPeriodEnd: periodEnd,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      paymentFailed: false,
      stripeSubscriptionId: "sub_1",
      ownerUserId: USER_ID,
    } as never);
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([
      { user: { name: "Ann", email: "ann@x.com" } },
    ] as never);
    // Paid + not cancelling => reconcile runs; an active subscription changes nothing.
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      status: "active",
      cancel_at_period_end: false,
    } as never);

    const state = await assembleBillingState(USER_ID, WS_ID);

    expect(state.plan).toBe("PRO");
    expect(state.collaboratorLimit).toBe(1);
    expect(state.currentPeriodEnd).toBe(periodEnd.toISOString());
    expect(state.membersToRemoveOnCancel).toEqual([{ name: "Ann", email: "ann@x.com" }]);
    expect(state.collaboratorCount).toBe(1);
  });

  it("reports trialUsed true when the flag is false but a durable claim exists on the email", async () => {
    // e.g. a card-denied trial: the user never got the trial, but must not be
    // offered one again.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      trialUsed: false,
      email: "reused@example.com",
    } as never);
    vi.mocked(hasTrialClaim).mockResolvedValue(true);
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "FREE",
      billingCycle: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      paymentFailed: false,
      stripeSubscriptionId: null,
      ownerUserId: USER_ID,
    } as never);

    const state = await assembleBillingState(USER_ID, WS_ID);
    expect(state.trialUsed).toBe(true);
  });

  it("reports trialUsed false when neither the flag nor a claim is present", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      trialUsed: false,
      email: "fresh@example.com",
    } as never);
    vi.mocked(hasTrialClaim).mockResolvedValue(false);
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "FREE",
      billingCycle: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      paymentFailed: false,
      stripeSubscriptionId: null,
      ownerUserId: USER_ID,
    } as never);

    const state = await assembleBillingState(USER_ID, WS_ID);
    expect(state.trialUsed).toBe(false);
  });

  it("reports isOwner false when the user does not own the workspace", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "FREE",
      billingCycle: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      paymentFailed: false,
      stripeSubscriptionId: null,
      ownerUserId: "someone-else",
    } as never);

    const state = await assembleBillingState(USER_ID, WS_ID);
    expect(state.isOwner).toBe(false);
  });
});
