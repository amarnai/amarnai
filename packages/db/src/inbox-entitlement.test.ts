import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: { emailConnection: { findMany: vi.fn() } },
}));

import { db } from "./client";
import { getInboxPlanCeiling, getInboxBackfillCeiling } from "./inbox-entitlement";

const conn = (plan: string, billingCycle: string | null) => ({
  workspace: { plan, billingCycle },
});

const connPaid = (plan: string, billingCycle: string | null, firstPaidAt: Date | null) => ({
  workspace: { plan, billingCycle, firstPaidAt },
});

beforeEach(() => vi.clearAllMocks());

describe("getInboxPlanCeiling", () => {
  it("returns FREE when no active connection shares the inbox", async () => {
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([] as never);
    expect(await getInboxPlanCeiling("ben@gmail.com")).toEqual({ plan: "FREE", billingCycle: null });
  });

  it("sizes by the TOP plan among workspaces sharing the inbox (FREE + BUSINESS -> BUSINESS)", async () => {
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      conn("FREE", null),
      conn("BUSINESS", "MONTHLY"),
      conn("PRO", "ANNUAL"),
    ] as never);
    expect(await getInboxPlanCeiling("ben@gmail.com")).toEqual({ plan: "BUSINESS", billingCycle: "MONTHLY" });
  });

  it("within the same plan, ANNUAL outranks MONTHLY", async () => {
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      conn("PRO", "MONTHLY"),
      conn("PRO", "ANNUAL"),
    ] as never);
    expect(await getInboxPlanCeiling("ben@gmail.com")).toEqual({ plan: "PRO", billingCycle: "ANNUAL" });
  });
});

describe("getInboxBackfillCeiling (payment gate)", () => {
  it("gate ON: an unpaid (trialing) PRO workspace contributes only FREE", async () => {
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      connPaid("PRO", "ANNUAL", null),
    ] as never);
    expect(await getInboxBackfillCeiling("ben@gmail.com", { requirePayment: true })).toEqual({
      plan: "FREE",
      billingCycle: null,
    });
  });

  it("gate ON: a PAID PRO workspace contributes PRO", async () => {
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      connPaid("PRO", "ANNUAL", new Date("2026-01-01T00:00:00Z")),
    ] as never);
    expect(await getInboxBackfillCeiling("ben@gmail.com", { requirePayment: true })).toEqual({
      plan: "PRO",
      billingCycle: "ANNUAL",
    });
  });

  it("gate OFF: an unpaid PRO workspace still contributes PRO (self-host passthrough)", async () => {
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      connPaid("PRO", "MONTHLY", null),
    ] as never);
    expect(await getInboxBackfillCeiling("ben@gmail.com", { requirePayment: false })).toEqual({
      plan: "PRO",
      billingCycle: "MONTHLY",
    });
  });

  it("gate ON: shared inbox clamps per-connection BEFORE pooling (paid PRO + trialing BUSINESS -> PRO)", async () => {
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      connPaid("PRO", "ANNUAL", new Date("2026-01-01T00:00:00Z")),
      connPaid("BUSINESS", "ANNUAL", null),
    ] as never);
    expect(await getInboxBackfillCeiling("ben@gmail.com", { requirePayment: true })).toEqual({
      plan: "PRO",
      billingCycle: "ANNUAL",
    });
  });

  it("returns FREE when no active connection shares the inbox", async () => {
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([] as never);
    expect(await getInboxBackfillCeiling("ben@gmail.com", { requirePayment: true })).toEqual({
      plan: "FREE",
      billingCycle: null,
    });
  });
});
