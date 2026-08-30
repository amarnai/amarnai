import { vi, describe, it, expect, beforeEach } from "vitest";

const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
}));

vi.mock("./stripe", () => ({
  isStripeConfigured: vi.fn(),
  getStripe: () => mockStripe,
}));

vi.mock("@aziru/db", () => ({
  db: {
    pendingSubscriptionCancellation: { findMany: vi.fn(), delete: vi.fn(), update: vi.fn() },
  },
}));

import { db } from "@aziru/db";
import { isStripeConfigured } from "./stripe";
import { processPendingSubscriptionCancellations } from "./pending-cancellations";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isStripeConfigured).mockReturnValue(true);
  vi.mocked(db.pendingSubscriptionCancellation.delete).mockResolvedValue({} as never);
  vi.mocked(db.pendingSubscriptionCancellation.update).mockResolvedValue({} as never);
  mockStripe.subscriptions.retrieve.mockResolvedValue({ status: "active" } as never);
  mockStripe.subscriptions.cancel.mockResolvedValue({} as never);
});

// A row that is immediately due to be retried (never attempted).
function dueRow(overrides: Record<string, unknown> = {}) {
  return { id: "pc_1", stripeSubscriptionId: "sub_a", attempts: 0, lastAttemptAt: null, ...overrides };
}

describe("processPendingSubscriptionCancellations", () => {
  it("no-ops (returns 0) when Stripe is unconfigured", async () => {
    vi.mocked(isStripeConfigured).mockReturnValue(false);

    const resolved = await processPendingSubscriptionCancellations();

    expect(resolved).toBe(0);
    expect(db.pendingSubscriptionCancellation.findMany).not.toHaveBeenCalled();
  });

  it("cancels an active subscription and deletes the resolved row", async () => {
    vi.mocked(db.pendingSubscriptionCancellation.findMany).mockResolvedValue([dueRow()] as never);

    const resolved = await processPendingSubscriptionCancellations();

    expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith("sub_a");
    expect(db.pendingSubscriptionCancellation.delete).toHaveBeenCalledWith({ where: { id: "pc_1" } });
    expect(resolved).toBe(1);
  });

  it("reads a bounded, oldest-first batch so a deletion burst cannot fan out unbounded", async () => {
    vi.mocked(db.pendingSubscriptionCancellation.findMany).mockResolvedValue([] as never);

    await processPendingSubscriptionCancellations();

    expect(db.pendingSubscriptionCancellation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expect.any(Number),
        orderBy: { lastAttemptAt: { sort: "asc", nulls: "first" } },
      })
    );
  });

  it("deletes a row whose subscription is already canceled (without calling cancel)", async () => {
    vi.mocked(db.pendingSubscriptionCancellation.findMany).mockResolvedValue([dueRow()] as never);
    mockStripe.subscriptions.retrieve.mockResolvedValue({ status: "canceled" } as never);

    const resolved = await processPendingSubscriptionCancellations();

    expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(db.pendingSubscriptionCancellation.delete).toHaveBeenCalledOnce();
    expect(resolved).toBe(1);
  });

  it("increments attempts and keeps the row when Stripe still fails", async () => {
    vi.mocked(db.pendingSubscriptionCancellation.findMany).mockResolvedValue([dueRow()] as never);
    mockStripe.subscriptions.retrieve.mockRejectedValue(new Error("still down"));

    const resolved = await processPendingSubscriptionCancellations();

    expect(db.pendingSubscriptionCancellation.delete).not.toHaveBeenCalled();
    expect(db.pendingSubscriptionCancellation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pc_1" },
        data: expect.objectContaining({ attempts: { increment: 1 } }),
      })
    );
    expect(resolved).toBe(0);
  });

  it("skips rows that are not yet due under backoff", async () => {
    // Attempted moments ago with several prior failures → backed off, not due.
    vi.mocked(db.pendingSubscriptionCancellation.findMany).mockResolvedValue([
      dueRow({ attempts: 5, lastAttemptAt: new Date() }),
    ] as never);

    const resolved = await processPendingSubscriptionCancellations();

    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(db.pendingSubscriptionCancellation.update).not.toHaveBeenCalled();
    expect(db.pendingSubscriptionCancellation.delete).not.toHaveBeenCalled();
    expect(resolved).toBe(0);
  });
});
