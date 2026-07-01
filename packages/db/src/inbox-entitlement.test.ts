import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: { gmailConnection: { findMany: vi.fn() } },
}));

import { db } from "./client";
import { getInboxPlanCeiling } from "./inbox-entitlement";

const conn = (plan: string, billingCycle: string | null) => ({
  workspace: { plan, billingCycle },
});

beforeEach(() => vi.clearAllMocks());

describe("getInboxPlanCeiling", () => {
  it("returns FREE when no active connection shares the inbox", async () => {
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([] as never);
    expect(await getInboxPlanCeiling("ben@gmail.com")).toEqual({ plan: "FREE", billingCycle: null });
  });

  it("sizes by the TOP plan among workspaces sharing the inbox (FREE + BUSINESS -> BUSINESS)", async () => {
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([
      conn("FREE", null),
      conn("BUSINESS", "MONTHLY"),
      conn("PRO", "ANNUAL"),
    ] as never);
    expect(await getInboxPlanCeiling("ben@gmail.com")).toEqual({ plan: "BUSINESS", billingCycle: "MONTHLY" });
  });

  it("within the same plan, ANNUAL outranks MONTHLY", async () => {
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([
      conn("PRO", "MONTHLY"),
      conn("PRO", "ANNUAL"),
    ] as never);
    expect(await getInboxPlanCeiling("ben@gmail.com")).toEqual({ plan: "PRO", billingCycle: "ANNUAL" });
  });
});
