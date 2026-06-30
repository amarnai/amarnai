import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: {
    inboxUsageMeter: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    inboxBackfillGrant: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

// resolveInboxQuota -> getInboxPlanCeiling pulls from this module; stub it so the
// grace tests don't hit it (resolveBackfillBudget itself doesn't use it).
vi.mock("./inbox-entitlement", () => ({ getInboxPlanCeiling: vi.fn() }));

import { db } from "./client";
import { resolveBackfillBudget } from "./usage-meter";

const WINDOW = new Date("2026-06-01T00:00:00Z");
const base = { inboxKey: "ben@gmail.com", workspaceId: "ws1", windowStart: WINDOW };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.inboxBackfillGrant.upsert).mockResolvedValue({} as never);
  vi.mocked(db.inboxUsageMeter.upsert).mockResolvedValue({} as never);
  // Default: the grace-token claim succeeds (this run wins it).
  vi.mocked(db.inboxUsageMeter.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe("resolveBackfillBudget", () => {
  it("first import (no meter, no grant): full cap, creates a grant, no grace", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue(null as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 500, graceConsumed: false, blockedAwaitingWindow: false });
    expect(db.inboxBackfillGrant.upsert).toHaveBeenCalledOnce();
    expect(db.inboxUsageMeter.upsert).not.toHaveBeenCalled(); // grace not touched
  });

  it("resume with room left: budget is cap minus used, no grace", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 200, graceUsed: false } as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r.effectiveBudget).toBe(300);
    expect(r.graceConsumed).toBe(false);
  });

  it("pool exhausted + existing grant (reset re-run): atomically claims the grace to lift the ceiling to 2x", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 500, graceUsed: false } as never);
    vi.mocked(db.inboxBackfillGrant.findUnique).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(db.inboxUsageMeter.updateMany).mockResolvedValue({ count: 1 } as never); // wins the token

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 500, graceConsumed: true, blockedAwaitingWindow: false });
    // Grace claimed via a conditional update guarded on graceUsed=false (not a blind upsert).
    expect(db.inboxUsageMeter.updateMany).toHaveBeenCalledWith({
      where: { inboxKey: base.inboxKey, kind: "BACKFILL", windowStart: base.windowStart, graceUsed: false },
      data: { graceUsed: true },
    });
  });

  it("grace race: a concurrent run that LOSES the atomic claim gets no grace (bounds total to 2x)", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 500, graceUsed: false } as never);
    vi.mocked(db.inboxBackfillGrant.findUnique).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(db.inboxUsageMeter.updateMany).mockResolvedValue({ count: 0 } as never); // another run took it

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 0, graceConsumed: false, blockedAwaitingWindow: true });
  });

  it("pool exhausted + grace already used: blocked until the window rolls", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 1000, graceUsed: true } as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 0, graceConsumed: false, blockedAwaitingWindow: true });
    expect(db.inboxBackfillGrant.findUnique).not.toHaveBeenCalled();
  });

  it("pool exhausted + no grant (new workspace, pool drained): no free allowance, no grace", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 500, graceUsed: false } as never);
    vi.mocked(db.inboxBackfillGrant.findUnique).mockResolvedValue(null as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r.effectiveBudget).toBe(0);
    expect(r.graceConsumed).toBe(false);
    expect(db.inboxUsageMeter.upsert).not.toHaveBeenCalled();
  });

  it("total imports stay bounded by 2x cap across a normal import + one grace re-run", async () => {
    // Normal import fills the pool to the cap.
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 0, graceUsed: false } as never);
    const first = await resolveBackfillBudget({ ...base, cap: 500 });
    // Reset re-run: pool still remembers the 500, grant exists → one grace re-import.
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 500, graceUsed: false } as never);
    vi.mocked(db.inboxBackfillGrant.findUnique).mockResolvedValue({ id: "g1" } as never);
    const second = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(first.effectiveBudget + second.effectiveBudget).toBe(1000); // == 2 x cap
  });
});
