/**
 * Contract tests for scale-invariant routing mode (options.scaleInvariant).
 *
 * These are deliberately written against the *spec* of the mode, not against
 * whatever the current implementation happens to emit:
 *
 *   1. The headline claim is invariance — a routing decision must not change
 *      when the whole similarity distribution is rescaled (the affine map
 *      sim' = a·sim + b, a > 0, which leaves z-units gap/σ unchanged). Each
 *      invariance test runs the SAME taxonomy at two cosine scales and asserts
 *      the scale-invariant decision is identical while the legacy (absolute-gap)
 *      decision flips. If the implementation stopped being scale-invariant,
 *      these fail.
 *
 *   2. Every expectation is derived from the published thresholds
 *      (CROSS_BRANCH_Z_MARGIN, SOLE_CHILD_Z_MARGIN), not hardcoded. Each test
 *      first asserts its own z-statistic lands on the intended side of the
 *      imported constant (the precondition), then asserts the routing contract
 *      that side implies. Change a constant and the precondition documents why.
 *
 * Similarities are set directly via buildSimTable (cosine = the requested value),
 * so the inputs are exact and the z-arithmetic in each comment is reproducible.
 */
import { describe, it, expect } from "vitest";
import {
  sortThreadByEmbedding,
  CROSS_BRANCH_Z_MARGIN,
  SOLE_CHILD_Z_MARGIN,
} from "../embedding/sorter.js";
import { buildSimTable, makeSimEmbedder } from "./fixtures/sim-embedder.js";
import type {
  AIProvider,
  TaxonomyNodeInput,
  TaxonomyEdgeInput,
  ThreadMessage,
} from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function n(
  id: string,
  name: string,
  description: string | null,
  isRoot = false
): TaxonomyNodeInput {
  return { id, name, description, instructions: null, examples: [], isRoot };
}

function e(id: string, sourceNodeId: string, targetNodeId: string): TaxonomyEdgeInput {
  return { id, sourceNodeId, targetNodeId };
}

function msg(subject: string, bodyText: string): ThreadMessage {
  return { subject, senderEmail: "test@example.com", senderName: null, bodyText, receivedAt: new Date() };
}

/** LLM stub that records whether it was consulted and what it returned. */
function makeLlmSpy(jsonResponse: string): { provider: AIProvider; calls: { count: number } } {
  const calls = { count: 0 };
  return {
    provider: {
      providerName: "mock",
      modelName: "mock-llm",
      async chat() {
        calls.count += 1;
        return jsonResponse;
      },
    },
    calls,
  };
}

/**
 * Mean and population std-dev of the thread's scored similarities — the exact
 * statistic the sorter divides by (sigmaSim). Only non-root nodes with a
 * description are embedded and scored, which is every non-root node here.
 */
function simStats(values: number[]): { mean: number; sigma: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, sigma: Math.sqrt(variance) };
}

const LLM_PICK = (candidate: string): string =>
  JSON.stringify({ selectedNodeId: candidate, confidence: 0.9, explanation: "stub", needsHumanReview: false });

// ─── Scenario A: cross-branch decision is invariant under rescaling ───────────
//
// Flat taxonomy: Inbox → A, B, C. The top two branches (A, B) are the contest.
//
//   base       A=0.40 B=0.36 C=0.25   gap(A,B)=0.04   σ=0.06342   z=0.631
//   rescaled   A=0.50 B=0.42 C=0.20   gap(A,B)=0.08   σ=0.12684   z=0.631   (= 2·base − 0.30)
//
// z is identical (affine-invariant) and sits ABOVE CROSS_BRANCH_Z_MARGIN (0.5),
// so scale-invariant mode must route to A — the SAME decision — at both scales.
// Legacy compares the absolute gap to CROSS_BRANCH_MARGIN (0.05): base 0.04 is
// below it (escalates) and rescaled 0.08 is above it (routes). The legacy
// decision flips with scale; the scale-invariant one does not.

describe("scale-invariant — cross-branch decision is invariant under cosine rescaling", () => {
  const ROOT = n("inbox", "Inbox", null, true);
  const A = n("a", "Alpha", "Administrative scheduling and calendar coordination");
  const B = n("b", "Beta", "Sales inquiries and inbound lead qualification");
  const C = n("c", "Gamma", "Finance, billing, and payment processing");
  const NODES = [ROOT, A, B, C];
  const EDGES = [e("e-a", "inbox", "a"), e("e-b", "inbox", "b"), e("e-c", "inbox", "c")];
  const messages = [msg("Request", "Ambiguous between the top two branches")];

  const BASE = { a: 0.4, b: 0.36, c: 0.25 };
  const RESCALED = { a: 0.5, b: 0.42, c: 0.2 }; // 2·BASE − 0.30, element-wise

  // Precondition: both scales put the A/B gap on the SAME (confident) side of
  // the z-margin, and the z-values are equal — that is the property under test.
  const zBase = (() => {
    const { sigma } = simStats([BASE.a, BASE.b, BASE.c]);
    return (BASE.a - BASE.b) / sigma;
  })();
  const zRescaled = (() => {
    const { sigma } = simStats([RESCALED.a, RESCALED.b, RESCALED.c]);
    return (RESCALED.a - RESCALED.b) / sigma;
  })();

  it("precondition: the rescale leaves the z-gap unchanged and above the margin", () => {
    expect(zBase).toBeCloseTo(zRescaled, 6);
    expect(zBase).toBeGreaterThan(CROSS_BRANCH_Z_MARGIN);
  });

  function run(sims: Record<string, number>, scaleInvariant: boolean) {
    const table = buildSimTable(NODES, EDGES, sims, messages);
    const embedder = makeSimEmbedder(table);
    // Returning candidate_0 lets a legacy escalation resolve deterministically;
    // scale-invariant runs must not consult it at all.
    const { provider, calls } = makeLlmSpy(LLM_PICK("candidate_0"));
    return {
      result: sortThreadByEmbedding(embedder, provider, NODES, EDGES, messages, { scaleInvariant }),
      calls,
    };
  }

  it("scale-invariant: same decision (route to A, no LLM) at both scales", async () => {
    const base = run(BASE, true);
    const rescaled = run(RESCALED, true);
    const baseResult = await base.result;
    const rescaledResult = await rescaled.result;

    expect(baseResult.finalNodeId).toBe("a");
    expect(rescaledResult.finalNodeId).toBe("a");
    expect(baseResult.decisionSource).toBe("embedding_auto");
    expect(rescaledResult.decisionSource).toBe("embedding_auto");
    expect(base.calls.count).toBe(0);
    expect(rescaled.calls.count).toBe(0);
  });

  it("legacy: decision flips with scale (base escalates, rescaled does not)", async () => {
    const base = run(BASE, false);
    const rescaled = run(RESCALED, false);
    const baseResult = await base.result;
    const rescaledResult = await rescaled.result;

    // base: absolute gap 0.04 < CROSS_BRANCH_MARGIN → escalate to the LLM
    expect(base.calls.count).toBe(1);
    expect(baseResult.decisionSource).toBe("llm");
    // rescaled: absolute gap 0.08 ≥ CROSS_BRANCH_MARGIN → route by embeddings
    expect(rescaled.calls.count).toBe(0);
    expect(rescaledResult.finalNodeId).toBe("a");
  });
});

// ─── Scenario B: sole-child descend-vs-stay ───────────────────────────────────
//
// Inbox → Parent → SoleChild, plus Inbox → Other (a sibling so σ reflects more
// than two points). A parent with exactly one child always clears the legacy
// spread test, so legacy descends into the child unconditionally — the
// single-child over-routing bug. Scale-invariant mode only auto-descends when
// the child beats the parent by more than SOLE_CHILD_Z_MARGIN (0.5) σ.

describe("scale-invariant — sole-child descend-vs-stay", () => {
  const ROOT = n("inbox", "Inbox", null, true);
  const PARENT = n("parent", "Deliveries", "Parcel deliveries and shipment tracking, any carrier");
  const SOLE = n("sole", "SwiftShip", "SwiftShip courier dispatch and tracking notifications");
  const OTHER = n("other", "Payments", "Invoices, receipts, and payment confirmations");
  const NODES = [ROOT, PARENT, SOLE, OTHER];
  const EDGES = [
    e("e-parent", "inbox", "parent"),
    e("e-sole", "parent", "sole"),
    e("e-other", "inbox", "other"),
  ];

  it("ambiguous child (low z-margin) does NOT auto-descend: stops at parent under suppression", async () => {
    // Parent=0.30 SoleChild=0.32 Other=0.10 → σ=0.09933, child−parent z=0.201
    const sims = { parent: 0.3, sole: 0.32, other: 0.1 };
    const messages = [msg("Generic parcel", "A tracking update not tied to any specific carrier")];
    const { sigma } = simStats([sims.parent, sims.sole, sims.other]);
    const zChild = (sims.sole - sims.parent) / sigma;

    // Precondition: the child does NOT clearly dominate the parent.
    expect(zChild).toBeLessThan(SOLE_CHILD_Z_MARGIN);

    const table = buildSimTable(NODES, EDGES, sims, messages);
    const embedder = makeSimEmbedder(table);
    const { provider, calls } = makeLlmSpy(LLM_PICK("candidate_0"));

    // Bulk path never calls the LLM; an ambiguous sole child must stop at the
    // parent rather than over-route into the specific leaf.
    const result = await sortThreadByEmbedding(embedder, provider, NODES, EDGES, messages, {
      scaleInvariant: true,
      suppressLlmEscalation: true,
    });
    expect(result.finalNodeId).toBe("parent");
    expect(calls.count).toBe(0);
  });

  it("ambiguous child escalates to the LLM and honors its choice (parent vs child)", async () => {
    const sims = { parent: 0.3, sole: 0.32, other: 0.1 };
    const messages = [msg("Generic parcel", "A tracking update not tied to any specific carrier")];

    // candidate_0 = parent, candidate_1 = sole child (buildLlmCandidates order).
    const stay = makeLlmSpy(LLM_PICK("candidate_0"));
    const descend = makeLlmSpy(LLM_PICK("candidate_1"));
    const table = buildSimTable(NODES, EDGES, sims, messages);
    const embedder = makeSimEmbedder(table);

    const stayResult = await sortThreadByEmbedding(embedder, stay.provider, NODES, EDGES, messages, {
      scaleInvariant: true,
    });
    expect(stay.calls.count).toBe(1); // ambiguous sole child consults the LLM
    expect(stayResult.finalNodeId).toBe("parent"); // LLM chose to stay

    const descendResult = await sortThreadByEmbedding(embedder, descend.provider, NODES, EDGES, messages, {
      scaleInvariant: true,
    });
    expect(descend.calls.count).toBe(1);
    expect(descendResult.finalNodeId).toBe("sole"); // LLM chose to descend
  });

  it("dominant child (high z-margin) auto-descends without the LLM", async () => {
    // Parent=0.20 SoleChild=0.50 Other=0.10 → σ=0.16997, child−parent z=1.765
    const sims = { parent: 0.2, sole: 0.5, other: 0.1 };
    const messages = [msg("SwiftShip dispatch", "Your SwiftShip parcel has shipped")];
    const { sigma } = simStats([sims.parent, sims.sole, sims.other]);
    const zChild = (sims.sole - sims.parent) / sigma;

    // Precondition: the child clearly dominates the parent.
    expect(zChild).toBeGreaterThan(SOLE_CHILD_Z_MARGIN);

    const table = buildSimTable(NODES, EDGES, sims, messages);
    const embedder = makeSimEmbedder(table);
    const { provider, calls } = makeLlmSpy(LLM_PICK("candidate_0"));

    const result = await sortThreadByEmbedding(embedder, provider, NODES, EDGES, messages, {
      scaleInvariant: true,
    });
    // Genuine specific match still routes to the leaf, with no LLM cost.
    expect(result.finalNodeId).toBe("sole");
    expect(calls.count).toBe(0);
  });

  it("legacy mode descends into the sole child unconditionally (the bug this fixes)", async () => {
    // Same ambiguous similarities as the first case; legacy has no sole-child gate.
    const sims = { parent: 0.3, sole: 0.32, other: 0.1 };
    const messages = [msg("Generic parcel", "A tracking update not tied to any specific carrier")];
    const table = buildSimTable(NODES, EDGES, sims, messages);
    const embedder = makeSimEmbedder(table);
    const { provider, calls } = makeLlmSpy(LLM_PICK("candidate_0"));

    const result = await sortThreadByEmbedding(embedder, provider, NODES, EDGES, messages, {
      scaleInvariant: false,
    });
    expect(result.finalNodeId).toBe("sole"); // descended despite the near-tie
    expect(calls.count).toBe(0);
  });
});

// ─── Scenario C: degenerate distribution does not divide by zero ──────────────
//
// All similarities equal → σ = 0, floored to 1e-6 before any division. A perfect
// tie is maximally ambiguous, so the contract is "escalate to the LLM", and the
// run must not throw or produce NaN from a /0.

describe("scale-invariant — degenerate (all-equal) similarities are safe", () => {
  const ROOT = n("inbox", "Inbox", null, true);
  const A = n("a", "Alpha", "Administrative scheduling and calendar coordination");
  const B = n("b", "Beta", "Sales inquiries and inbound lead qualification");
  const NODES = [ROOT, A, B];
  const EDGES = [e("e-a", "inbox", "a"), e("e-b", "inbox", "b")];

  it("a true tie escalates to the LLM instead of throwing on a zero σ", async () => {
    const sims = { a: 0.4, b: 0.4 }; // σ = 0 → floored
    const messages = [msg("Tie", "Equally similar to both branches")];
    const table = buildSimTable(NODES, EDGES, sims, messages);
    const embedder = makeSimEmbedder(table);
    const { provider, calls } = makeLlmSpy(LLM_PICK("candidate_0"));

    const result = await sortThreadByEmbedding(embedder, provider, NODES, EDGES, messages, {
      scaleInvariant: true,
    });
    expect(calls.count).toBe(1); // ambiguous tie → LLM consulted
    expect(result.finalNodeId).not.toBeNaN();
  });
});
