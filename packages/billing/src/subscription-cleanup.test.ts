import { vi, describe, it, expect, beforeEach } from "vitest";
import Stripe from "stripe";

const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
}));

vi.mock("./stripe", () => ({
  isStripeConfigured: vi.fn(),
  getStripe: () => mockStripe,
}));

vi.mock("@aziru/db", () => ({
  db: {
    workspace: { findMany: vi.fn() },
    pendingSubscriptionCancellation: { upsert: vi.fn() },
  },
}));

import { db } from "@aziru/db";
import { isStripeConfigured } from "./stripe";
import { cancelSubscriptionsForAccountDeletion } from "./subscription-cleanup";

const USER_ID = "user-1";

function resourceMissing() {
  return new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    message: "No such subscription",
    code: "resource_missing",
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isStripeConfigured).mockReturnValue(true);
  vi.mocked(db.pendingSubscriptionCancellation.upsert).mockResolvedValue({} as never);
  mockStripe.subscriptions.retrieve.mockResolvedValue({ status: "active" } as never);
  mockStripe.subscriptions.cancel.mockResolvedValue({} as never);
});

describe("cancelSubscriptionsForAccountDeletion", () => {
  it("cancels every owned subscription and records no pending rows on success", async () => {
    vi.mocked(db.workspace.findMany).mockResolvedValue([
      { stripeSubscriptionId: "sub_a" },
      { stripeSubscriptionId: "sub_b" },
    ] as never);

    await cancelSubscriptionsForAccountDeletion(USER_ID);

    expect(mockStripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
    expect(db.pendingSubscriptionCancellation.upsert).not.toHaveBeenCalled();
  });

  it("queues a durable retry (never throws) when Stripe fails transiently", async () => {
    vi.mocked(db.workspace.findMany).mockResolvedValue([
      { stripeSubscriptionId: "sub_a" },
    ] as never);
    mockStripe.subscriptions.retrieve.mockRejectedValue(new Error("network down"));

    await expect(cancelSubscriptionsForAccountDeletion(USER_ID)).resolves.toBeUndefined();

    expect(db.pendingSubscriptionCancellation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeSubscriptionId: "sub_a" } })
    );
  });

  it("treats a missing subscription as already done (no pending row)", async () => {
    vi.mocked(db.workspace.findMany).mockResolvedValue([
      { stripeSubscriptionId: "sub_a" },
    ] as never);
    mockStripe.subscriptions.retrieve.mockRejectedValue(resourceMissing());

    await cancelSubscriptionsForAccountDeletion(USER_ID);

    expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(db.pendingSubscriptionCancellation.upsert).not.toHaveBeenCalled();
  });

  it("treats an already-canceled subscription as done without calling cancel", async () => {
    vi.mocked(db.workspace.findMany).mockResolvedValue([
      { stripeSubscriptionId: "sub_a" },
    ] as never);
    mockStripe.subscriptions.retrieve.mockResolvedValue({ status: "canceled" } as never);

    await cancelSubscriptionsForAccountDeletion(USER_ID);

    expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(db.pendingSubscriptionCancellation.upsert).not.toHaveBeenCalled();
  });

  it("records a pending row when Stripe is unconfigured but a subscription exists", async () => {
    vi.mocked(isStripeConfigured).mockReturnValue(false);
    vi.mocked(db.workspace.findMany).mockResolvedValue([
      { stripeSubscriptionId: "sub_a" },
    ] as never);

    await cancelSubscriptionsForAccountDeletion(USER_ID);

    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(db.pendingSubscriptionCancellation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeSubscriptionId: "sub_a" } })
    );
  });
});
