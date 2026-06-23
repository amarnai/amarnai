import { describe, it, expect } from "vitest";
import { RoutingTelemetrySchema } from "@amarnai/shared";
import { buildRoutingTelemetry, TELEMETRY_TOP_K } from "../embedding/telemetry.js";

describe("buildRoutingTelemetry", () => {
  it("captures the maxima and a schema-valid payload", () => {
    const t = buildRoutingTelemetry(
      {
        rawSimilarities: { a: 0.2, b: 0.5, c: 0.1 },
        subtreeScores: { a: 0.3, b: 0.55, root: 0.0 },
      },
      0.15,
    );

    expect(t.maxRawSim).toBe(0.5);
    expect(t.maxSubtreeScore).toBe(0.55);
    expect(t.thetaMin).toBe(0.15);
    // Schema round-trips, so the value is safe to persist into rawOutput.
    expect(() => RoutingTelemetrySchema.parse(t)).not.toThrow();
  });

  it("ranks top similarities descending and caps at TELEMETRY_TOP_K", () => {
    const rawSimilarities: Record<string, number> = {};
    for (let i = 0; i < 20; i++) rawSimilarities[`n${i}`] = i / 100;

    const t = buildRoutingTelemetry({ rawSimilarities, subtreeScores: {} }, 0.15);

    expect(t.topRawSims).toHaveLength(TELEMETRY_TOP_K);
    expect(t.topRawSims[0]).toEqual({ nodeId: "n19", sim: 0.19 });
    const sims = t.topRawSims.map((s) => s.sim);
    expect(sims).toEqual([...sims].sort((a, b) => b - a));
  });

  it("is well-defined for an empty similarity map", () => {
    const t = buildRoutingTelemetry({ rawSimilarities: {}, subtreeScores: {} }, 0.15);
    expect(t.maxRawSim).toBe(0);
    expect(t.maxSubtreeScore).toBe(0);
    expect(t.topRawSims).toEqual([]);
  });
});
