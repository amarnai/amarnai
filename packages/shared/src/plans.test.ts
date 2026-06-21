import { describe, it, expect } from "vitest";
import { PLANS, PLAN_FEATURES } from "./plans.js";

// These constants moved out of @amarnai/ui so non-DOM clients (mobile) can use
// them. This guards against re-introducing a DOM/React dependency: the module
// must import cleanly in a plain Node (non-jsdom) environment.
describe("@amarnai/shared plans", () => {
  it("exposes the three plans with prices", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "pro", "business"]);
    const pro = PLANS.find((p) => p.id === "pro");
    expect(pro?.monthlyPrice).toBe(5);
    expect(pro?.annualMonthlyPrice).toBe(4);
  });

  it("exposes feature definitions for every plan id", () => {
    for (const feature of PLAN_FEATURES) {
      expect(Object.keys(feature.values).sort()).toEqual(["business", "free", "pro"]);
    }
  });
});
