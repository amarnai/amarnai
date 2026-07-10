import { describe, expect, it } from "vitest";
import {
  DRAFT_LIMITS,
  getDraftLimit,
  getDraftQuotaWindowStart,
  getDraftQuotaResetsAt,
  formatQuotaResetDate,
} from "./draft-quota.js";

describe("getDraftLimit", () => {
  it("returns correct limits per plan", () => {
    expect(getDraftLimit("FREE")).toBe(3);
    expect(getDraftLimit("PRO")).toBe(200);
    expect(getDraftLimit("BUSINESS")).toBe(500);
  });

  it("falls back to FREE limit for unknown plans", () => {
    expect(getDraftLimit("UNKNOWN")).toBe(DRAFT_LIMITS["FREE"]);
  });
});

describe("getDraftQuotaWindowStart", () => {
  it("returns the 1st of the current month at UTC midnight", () => {
    const result = getDraftQuotaWindowStart(new Date("2026-06-15T14:32:00Z"));
    expect(result.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("is idempotent when called on the 1st of the month", () => {
    const result = getDraftQuotaWindowStart(new Date("2026-06-01T00:00:00Z"));
    expect(result.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("handles month boundary correctly (Dec → Jan)", () => {
    const result = getDraftQuotaWindowStart(new Date("2026-12-31T23:59:59Z"));
    expect(result.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("getDraftQuotaResetsAt", () => {
  it("returns the 1st of the next month at UTC midnight", () => {
    const result = getDraftQuotaResetsAt(new Date("2026-06-15T14:32:00Z"));
    expect(result.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("rolls over correctly from December to January", () => {
    const result = getDraftQuotaResetsAt(new Date("2026-12-31T23:59:59Z"));
    expect(result.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is always strictly after the window start", () => {
    const now = new Date("2026-06-15T14:32:00Z");
    expect(getDraftQuotaResetsAt(now).getTime()).toBeGreaterThan(
      getDraftQuotaWindowStart(now).getTime()
    );
  });
});

describe("formatQuotaResetDate", () => {
  it("formats a reset timestamp as a short UTC month/day", () => {
    expect(formatQuotaResetDate("2026-07-01T00:00:00.000Z")).toBe("Jul 1");
  });

  it("uses UTC so the day does not shift across timezones", () => {
    // Just past UTC midnight on the 1st: must still read as the 1st, not the 30th.
    expect(formatQuotaResetDate("2026-07-01T00:30:00.000Z")).toBe("Jul 1");
  });
});
