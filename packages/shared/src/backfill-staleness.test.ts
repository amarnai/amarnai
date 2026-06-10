import { describe, it, expect } from "vitest";
import { isBackfillResumable, BACKFILL_RUNNING_STALE_MS } from "./backfill-staleness.js";

describe("isBackfillResumable", () => {
  const now = new Date("2026-06-10T20:00:00Z");

  it("returns true for PENDING", () => {
    expect(isBackfillResumable("PENDING", null, now)).toBe(true);
  });

  it("returns true for ERROR", () => {
    expect(isBackfillResumable("ERROR", new Date(), now)).toBe(true);
  });

  it("returns false for DONE", () => {
    expect(isBackfillResumable("DONE", null, now)).toBe(false);
  });

  it("returns true for RUNNING with null startedAt", () => {
    expect(isBackfillResumable("RUNNING", null, now)).toBe(true);
  });

  it("returns false for fresh RUNNING (within stale threshold)", () => {
    const startedAt = new Date(now.getTime() - 30 * 60 * 1_000); // 30 min ago
    expect(isBackfillResumable("RUNNING", startedAt, now)).toBe(false);
  });

  it("returns true for stale RUNNING (older than threshold)", () => {
    const startedAt = new Date(now.getTime() - BACKFILL_RUNNING_STALE_MS - 1);
    expect(isBackfillResumable("RUNNING", startedAt, now)).toBe(true);
  });

  it("returns false for RUNNING started exactly at threshold boundary (not yet stale)", () => {
    const startedAt = new Date(now.getTime() - BACKFILL_RUNNING_STALE_MS);
    expect(isBackfillResumable("RUNNING", startedAt, now)).toBe(false);
  });

  it("returns false for unknown status", () => {
    expect(isBackfillResumable("UNKNOWN", null, now)).toBe(false);
  });
});
