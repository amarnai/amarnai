import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: {
    inboxUsageMeter: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    inboxBackfillGrant: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

// resolveInboxQuota -> getInboxPlanCeiling pulls from this module; stub it so the
// grace tests don't hit it (resolveBackfillBudget itself doesn't use it).
vi.mock("./inbox-entitlement", () => ({ getInboxPlanCeiling: vi.fn() }));

import { db } from "./client";
import { resolveBackfillBudget, getBackfillGraceUsed, GRACE_ROLLING_WINDOW_MS } from "./usage-meter";

const WINDOW = new Date("2026-06-01T00:00:00Z");
const base = { inboxKey: "ben@gmail.com", workspaceId: "ws1", windowStart: WINDOW };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.inboxBackfillGrant.upsert).mockResolvedValue({} as never);
  vi.mocked(db.inboxUsageMeter.upsert).mockResolvedValue({} as never);
  // Default: no grace claimed within the rolling 12-month window (eligible).
  vi.mocked(db.inboxUsageMeter.findFirst).mockResolvedValue(null as never);
  // Default: the grace-token claim succeeds (this run wins it).
  vi.mocked(db.inboxUsageMeter.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe("resolveBackfillBudget", () => {
  it("first import (no meter, no grant): full cap, creates a grant, not using grace", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue(null as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 500, usingGrace: false, blockedAwaitingWindow: false });
    expect(db.inboxBackfillGrant.upsert).toHaveBeenCalledOnce();
    expect(db.inboxUsageMeter.updateMany).not.toHaveBeenCalled(); // grace not touched
  });

  it("resume with room left: budget is cap minus used, not using grace", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 200, graceUsed: false } as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r.effectiveBudget).toBe(300);
    expect(r.usingGrace).toBe(false);
  });

  it("base cap hit + existing grant (reset re-run): atomically unlocks the grace, ceiling -> 2x", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 500, graceUsed: false } as never);
    vi.mocked(db.inboxBackfillGrant.findUnique).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(db.inboxUsageMeter.updateMany).mockResolvedValue({ count: 1 } as never); // wins the token

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 500, usingGrace: true, blockedAwaitingWindow: false });
    // Grace claimed via a conditional update guarded on graceUsed=false (not a blind
    // upsert), stamping graceClaimedAt in the same statement for the rolling gate.
    expect(db.inboxUsageMeter.updateMany).toHaveBeenCalledWith({
      where: { inboxKey: base.inboxKey, kind: "BACKFILL", windowStart: base.windowStart, graceUsed: false },
      data: { graceUsed: true, graceClaimedAt: expect.any(Date) },
    });
  });

  it("grace blocked by rolling 12-month window: a claim within the last year → no grace", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 500, graceUsed: false } as never);
    vi.mocked(db.inboxBackfillGrant.findUnique).mockResolvedValue({ id: "g1" } as never);
    // A prior BACKFILL row carries a graceClaimedAt inside the rolling window.
    vi.mocked(db.inboxUsageMeter.findFirst).mockResolvedValue({ id: "prev" } as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 0, usingGrace: false, blockedAwaitingWindow: true });
    // Blocked before claiming — the atomic token flip must not run.
    expect(db.inboxUsageMeter.updateMany).not.toHaveBeenCalled();
    // The rolling lookback uses a 365-day cutoff.
    const call = vi.mocked(db.inboxUsageMeter.findFirst).mock.calls[0]![0] as {
      where: { graceClaimedAt: { gte: Date } };
    };
    const cutoff = call.where.graceClaimedAt.gte.getTime();
    expect(Date.now() - cutoff).toBeCloseTo(GRACE_ROLLING_WINDOW_MS, -4);
  });

  it("grace resume: a later chunk of the SAME re-import keeps its budget and does NOT re-claim (regression)", async () => {
    // graceUsed already true, used between cap and 2x cap → still budget left, no new claim.
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 600, graceUsed: true } as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 400, usingGrace: true, blockedAwaitingWindow: false }); // 2*500 - 600
    expect(db.inboxUsageMeter.updateMany).not.toHaveBeenCalled(); // grace already unlocked
    expect(db.inboxBackfillGrant.findUnique).not.toHaveBeenCalled();
  });

  it("grace race: a concurrent run that LOSES the atomic claim gets no grace (bounds total to 2x)", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 500, graceUsed: false } as never);
    vi.mocked(db.inboxBackfillGrant.findUnique).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(db.inboxUsageMeter.updateMany).mockResolvedValue({ count: 0 } as never); // another run took it

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 0, usingGrace: false, blockedAwaitingWindow: true });
  });

  it("base + grace fully spent (used >= 2x cap): blocked until the window rolls", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 1000, graceUsed: true } as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 0, usingGrace: true, blockedAwaitingWindow: true });
    expect(db.inboxBackfillGrant.findUnique).not.toHaveBeenCalled();
  });

  it("base cap hit + no grant (new workspace, pool drained): no allowance, not grace-blocked", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: 500, graceUsed: false } as never);
    vi.mocked(db.inboxBackfillGrant.findUnique).mockResolvedValue(null as never);

    const r = await resolveBackfillBudget({ ...base, cap: 500 });

    expect(r).toEqual({ effectiveBudget: 0, usingGrace: false, blockedAwaitingWindow: false });
    expect(db.inboxUsageMeter.updateMany).not.toHaveBeenCalled();
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

describe("getBackfillGraceUsed (rolling window)", () => {
  it("true when a BACKFILL row was grace-claimed within the last 12 months", async () => {
    vi.mocked(db.inboxUsageMeter.findFirst).mockResolvedValue({ id: "r1" } as never);
    expect(await getBackfillGraceUsed("ben@gmail.com")).toBe(true);
    const call = vi.mocked(db.inboxUsageMeter.findFirst).mock.calls[0]![0] as {
      where: { inboxKey: string; kind: string; graceClaimedAt: { gte: Date } };
    };
    expect(call.where.inboxKey).toBe("ben@gmail.com");
    expect(call.where.kind).toBe("BACKFILL");
    expect(Date.now() - call.where.graceClaimedAt.gte.getTime()).toBeCloseTo(GRACE_ROLLING_WINDOW_MS, -4);
  });

  it("false when no grace claim falls within the window", async () => {
    vi.mocked(db.inboxUsageMeter.findFirst).mockResolvedValue(null as never);
    expect(await getBackfillGraceUsed("ben@gmail.com")).toBe(false);
  });
});
