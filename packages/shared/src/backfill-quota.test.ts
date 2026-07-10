import { describe, it, expect } from "vitest";
import { getBackfillCap, BACKFILL_CAPS } from "./backfill-quota.js";

describe("getBackfillCap", () => {
  it("returns the Free cap (500 threads, full history) for both cycles", () => {
    expect(getBackfillCap("FREE", "MONTHLY")).toEqual({ maxThreads: 500, windowDays: null });
    expect(getBackfillCap("FREE", "ANNUAL")).toEqual({ maxThreads: 500, windowDays: null });
  });

  it("returns the Pro monthly cap (10,000 threads, full history)", () => {
    expect(getBackfillCap("PRO", "MONTHLY")).toEqual({ maxThreads: 10_000, windowDays: null });
  });

  it("returns the Pro annual cap (50,000 threads, full history)", () => {
    expect(getBackfillCap("PRO", "ANNUAL")).toEqual({ maxThreads: 50_000, windowDays: null });
  });

  it("returns the Business monthly cap (20,000 threads, full history)", () => {
    expect(getBackfillCap("BUSINESS", "MONTHLY")).toEqual({ maxThreads: 20_000, windowDays: null });
  });

  it("returns the Business annual cap (75,000 threads, full history)", () => {
    expect(getBackfillCap("BUSINESS", "ANNUAL")).toEqual({ maxThreads: 75_000, windowDays: null });
  });

  it("falls back to the monthly cap when billing cycle is null", () => {
    expect(getBackfillCap("PRO", null)).toEqual(BACKFILL_CAPS["PRO"]!.monthly);
    expect(getBackfillCap("BUSINESS", null)).toEqual(BACKFILL_CAPS["BUSINESS"]!.monthly);
  });

  it("falls back to the monthly cap for an unknown billing cycle", () => {
    expect(getBackfillCap("PRO", "WEEKLY")).toEqual(BACKFILL_CAPS["PRO"]!.monthly);
  });

  it("falls back to the Free caps for an unknown plan", () => {
    expect(getBackfillCap("ENTERPRISE", "ANNUAL")).toEqual(BACKFILL_CAPS["FREE"]!.annual);
    expect(getBackfillCap("ENTERPRISE", "MONTHLY")).toEqual(BACKFILL_CAPS["FREE"]!.monthly);
  });
});
