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
}));

vi.mock("@/lib/stripe", () => ({ getStripe: () => mockStripe }));

import { db } from "@amarnai/db";
import { assembleBillingState } from "@/lib/billing-state";

const USER_ID = "user-1";
const WS_ID = "ws-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: true } as never);
  vi.mocked(db.workspaceMember.findMany).mockResolvedValue([] as never);
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
    expect(state.collaboratorLimit).toBe(10);
    expect(state.currentPeriodEnd).toBe(periodEnd.toISOString());
    expect(state.membersToRemoveOnCancel).toEqual([{ name: "Ann", email: "ann@x.com" }]);
    expect(state.collaboratorCount).toBe(1);
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
