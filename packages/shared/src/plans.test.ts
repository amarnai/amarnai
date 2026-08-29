import { describe, it, expect } from "vitest";
import { PLANS, FEATURE_GROUPS, type FeatureRow } from "./plans.js";
import { THREAD_SUMMARY_LIMITS } from "./summary-quota.js";

// These constants moved out of @amarnai/ui so non-DOM clients (mobile) can use
// them. This guards against re-introducing a DOM/React dependency: the module
// must import cleanly in a plain Node (non-jsdom) environment.
describe("@amarnai/shared plans", () => {
  it("exposes the three plans with prices", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "pro", "business"]);
    const pro = PLANS.find((p) => p.id === "pro");
    expect(pro?.monthlyPrice).toBe(6);
    expect(pro?.annualMonthlyPrice).toBe(5);
  });

  it("exposes a value per plan on every comparison row", () => {
    for (const group of FEATURE_GROUPS) {
      for (const row of group.rows) {
        const cells = "values" in row ? [row.values] : Object.values(row.billing);
        for (const values of cells) {
          expect(values, `${group.name} / ${row.label}`).toHaveLength(PLANS.length);
        }
      }
    }
  });
});

// The pricing copy and the enforced caps are two hand-maintained lists. A drift
// between them shows a user one number and bills them against another.
describe("plan copy matches the enforced quotas", () => {
  const summaries = FEATURE_GROUPS.flatMap((g) => g.rows).find(
    (r): r is FeatureRow => "values" in r && r.label === "Thread summaries",
  );

  it("advertises the same thread-summary caps the meter enforces", () => {
    expect(summaries).toBeDefined();
    const [free, pro, business] = summaries!.values;
    expect(free).toContain(THREAD_SUMMARY_LIMITS["FREE"]!.toLocaleString("en"));
    expect(pro).toContain(THREAD_SUMMARY_LIMITS["PRO"]!.toLocaleString("en"));
    expect(business).toContain(THREAD_SUMMARY_LIMITS["BUSINESS"]!.toLocaleString("en"));
  });

  it("lists a summaries highlight on every plan card", () => {
    for (const plan of PLANS) {
      expect(plan.highlights.some((h) => h.includes("thread summaries"))).toBe(true);
    }
  });
});
