import type { RoutingTelemetry } from "@aziru/shared";
import type { EmbeddingSortResult } from "./sorter.js";

/**
 * Number of top node similarities retained in routing telemetry. Bounds the
 * persisted payload size: only the most relevant nodes are kept, not the full
 * per-node similarity map.
 */
export const TELEMETRY_TOP_K = 8;

/**
 * Summarise an embedding routing decision into a compact, storage-bounded
 * telemetry payload for EmailClassification.rawOutput.
 *
 * The scores are already computed by sortThreadByEmbedding on every run, so
 * this adds no compute — it only trims the in-memory maps down to the maxima
 * plus the top-K node similarities before they are dropped. `thetaMin` is the
 * quality-gate threshold actually used for the run, recorded so the gate
 * decision can be reconstructed even if the default later changes.
 */
export function buildRoutingTelemetry(
  result: Pick<EmbeddingSortResult, "rawSimilarities" | "subtreeScores" | "crossBranch">,
  thetaMin: number,
  topK: number = TELEMETRY_TOP_K,
): RoutingTelemetry {
  const sorted = Object.entries(result.rawSimilarities).sort((a, b) => b[1] - a[1]);
  const topRawSims = sorted.slice(0, topK).map(([nodeId, sim]) => ({ nodeId, sim }));
  const subtreeValues = Object.values(result.subtreeScores);
  return {
    v: 1,
    maxRawSim: sorted[0]?.[1] ?? 0,
    maxSubtreeScore: subtreeValues.length > 0 ? Math.max(...subtreeValues) : 0,
    thetaMin,
    topRawSims,
    crossBranch: result.crossBranch ?? null,
  };
}
