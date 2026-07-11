import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => {
  const db = {
    inboxUsageMeter: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    inboxBackfillGrant: { findUnique: vi.fn(), upsert: vi.fn() },
    idempotencyMarker: { createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  // The interactive-transaction mock runs the callback with the same client, so a
  // caller enlisting recordMeterUsage in a transaction still hits these mocks.
  db.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(db));
  return { db };
});

// resolveInboxQuota -> getInboxPlanCeiling pulls from this module; stub it so the
// grace tests don't hit it (resolveBackfillBudget itself doesn't use it).
vi.mock("./inbox-entitlement", () => ({ getInboxPlanCeiling: vi.fn() }));

import { db } from "./client";
import {
  resolveBackfillBudget,
  getBackfillGraceUsed,
  GRACE_ROLLING_WINDOW_MS,
  recordMeterUsage,
  claimIdempotencyToken,
  releaseIdempotencyToken,
  pruneIdempotencyMarkers,
  IDEMPOTENCY_MARKER_RETENTION_MS,
  MeterKind,
} from "./usage-meter";

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
  // Default idempotency-marker behavior: every token is unseen (claim wins).
  vi.mocked(db.idempotencyMarker.createMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(db.idempotencyMarker.deleteMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(db.$transaction).mockImplementation(((cb: (tx: unknown) => unknown) => cb(db)) as never);
});

// ─── Idempotent metering (the single reset-immune dedup mechanism) ─────────────

describe("recordMeterUsage idempotency", () => {
  const M = { inboxKey: "ben@gmail.com", kind: MeterKind.THREAD_SORT, windowStart: WINDOW };

  it("claims the dedup token and increments once on first sight", async () => {
    await recordMeterUsage({ ...M, delta: 1, dedupToken: "THREAD_SORT_ben_w_t1" });

    expect(db.idempotencyMarker.createMany).toHaveBeenCalledWith({
      data: [{ token: "THREAD_SORT_ben_w_t1" }],
      skipDuplicates: true,
    });
    expect(db.inboxUsageMeter.upsert).toHaveBeenCalledOnce();
    // Claim + increment are wrapped in one transaction so they can't tear apart.
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("a retry with the SAME dedup token increments EXACTLY once (the core guarantee)", async () => {
    // Faithful skipDuplicates: a token is inserted at most once across calls.
    const claimed = new Set<string>();
    vi.mocked(db.idempotencyMarker.createMany).mockImplementation((async (args: {
      data: { token: string }[];
    }) => {
      let count = 0;
      for (const row of args.data) {
        if (!claimed.has(row.token)) {
          claimed.add(row.token);
          count++;
        }
      }
      return { count };
    }) as never);

    const call = () =>
      recordMeterUsage({ ...M, delta: 1, dedupToken: "THREAD_SORT_ben_w_t1" });
    await call();
    await call(); // the retried/duplicated job

    expect(db.inboxUsageMeter.upsert).toHaveBeenCalledOnce(); // one unit, not two
  });

  it("distinct dedup tokens each increment (different threads still count)", async () => {
    const claimed = new Set<string>();
    vi.mocked(db.idempotencyMarker.createMany).mockImplementation((async (args: {
      data: { token: string }[];
    }) => {
      let count = 0;
      for (const row of args.data) {
        if (!claimed.has(row.token)) {
          claimed.add(row.token);
          count++;
        }
      }
      return { count };
    }) as never);

    await recordMeterUsage({ ...M, delta: 1, dedupToken: "tok-a" });
    await recordMeterUsage({ ...M, delta: 1, dedupToken: "tok-b" });

    expect(db.inboxUsageMeter.upsert).toHaveBeenCalledTimes(2);
  });

  it("without a dedup token keeps the bare upsert (no marker, no transaction)", async () => {
    await recordMeterUsage({ ...M, delta: 3 });

    expect(db.idempotencyMarker.createMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.inboxUsageMeter.upsert).toHaveBeenCalledOnce();
  });

  it("enlists in a caller's transaction client when tx is passed (no own transaction)", async () => {
    const tx = {
      idempotencyMarker: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      inboxUsageMeter: { upsert: vi.fn().mockResolvedValue({}) },
    };
    await recordMeterUsage({
      ...M,
      delta: 1,
      dedupToken: "tok-tx",
      tx: tx as never,
    });

    expect(tx.idempotencyMarker.createMany).toHaveBeenCalledOnce();
    expect(tx.inboxUsageMeter.upsert).toHaveBeenCalledOnce();
    // The caller owns the transaction — recordMeterUsage must not open its own.
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.inboxUsageMeter.upsert).not.toHaveBeenCalled();
  });

  it("delta <= 0 is a no-op (never claims a token)", async () => {
    await recordMeterUsage({ ...M, delta: 0, dedupToken: "tok-zero" });
    expect(db.idempotencyMarker.createMany).not.toHaveBeenCalled();
    expect(db.inboxUsageMeter.upsert).not.toHaveBeenCalled();
  });
});

describe("claim/release idempotency token", () => {
  it("claimIdempotencyToken returns true when it wins the insert, false on replay", async () => {
    vi.mocked(db.idempotencyMarker.createMany).mockResolvedValueOnce({ count: 1 } as never);
    expect(await claimIdempotencyToken("t")).toBe(true);
    vi.mocked(db.idempotencyMarker.createMany).mockResolvedValueOnce({ count: 0 } as never);
    expect(await claimIdempotencyToken("t")).toBe(false);
  });

  it("releaseIdempotencyToken deletes the marker so a later attempt can re-run", async () => {
    await releaseIdempotencyToken("t");
    expect(db.idempotencyMarker.deleteMany).toHaveBeenCalledWith({ where: { token: "t" } });
  });
});

describe("pruneIdempotencyMarkers", () => {
  it("deletes only markers older than the retention window and returns the count", async () => {
    vi.mocked(db.idempotencyMarker.deleteMany).mockResolvedValue({ count: 7 } as never);
    const now = new Date("2026-06-01T00:00:00Z");

    const deleted = await pruneIdempotencyMarkers(now);

    expect(deleted).toBe(7);
    const arg = vi.mocked(db.idempotencyMarker.deleteMany).mock.calls[0]![0] as {
      where: { createdAt: { lt: Date } };
    };
    // Cutoff is exactly one retention window before `now` — newer markers are kept.
    expect(arg.where.createdAt.lt.getTime()).toBe(now.getTime() - IDEMPOTENCY_MARKER_RETENTION_MS);
  });
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
