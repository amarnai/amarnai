import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: {
    emailThread: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

import { db } from "./client";
import { decayStaleReviews, REVIEW_DECAY_TTL_MS } from "./review-decay";

const NOW = new Date("2026-07-23T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decayStaleReviews", () => {
  it("promotes NEEDS_REVIEW threads whose latest classification predates the decay window", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([{ id: "t1" }, { id: "t2" }] as never);
    vi.mocked(db.emailThread.updateMany).mockResolvedValue({ count: 2 } as never);

    const promoted = await decayStaleReviews(NOW);

    expect(promoted).toBe(2);

    // Selects only review threads with no classification newer than the cutoff
    // (i.e. the latest sort is older than the window).
    const cutoff = new Date(NOW.getTime() - REVIEW_DECAY_TTL_MS);
    expect(db.emailThread.findMany).toHaveBeenCalledWith({
      where: {
        triageStatus: "NEEDS_REVIEW",
        classifications: { none: { createdAt: { gte: cutoff } } },
      },
      select: { id: true },
    });

    // The write re-guards on triageStatus so a thread that changed between the
    // scan and the update is skipped, not clobbered.
    expect(db.emailThread.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] }, triageStatus: "NEEDS_REVIEW" },
      data: { triageStatus: "SORTED" },
    });
  });

  it("is a no-op when nothing is stale (never issues an update)", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([] as never);

    const promoted = await decayStaleReviews(NOW);

    expect(promoted).toBe(0);
    expect(db.emailThread.updateMany).not.toHaveBeenCalled();
  });
});
