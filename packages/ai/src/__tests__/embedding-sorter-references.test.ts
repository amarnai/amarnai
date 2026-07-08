import { describe, it, expect, vi } from "vitest";
import { sortThreadByEmbedding, REFERENCE_SIM_WEIGHT } from "../embedding/sorter.js";
import {
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  deriveBreadcrumb,
} from "../embedding/math.js";
import type { EmbeddingProvider } from "../embedding/types.js";
import type { AIProvider, TaxonomyNodeInput, TaxonomyEdgeInput, ThreadMessage } from "../types.js";

// Reference-thread reinforcement: vectors of threads a user MANUALLY moved into
// a folder lift that folder's raw similarity via max(descSim, weight · refSim).
// These tests pin the blend semantics deterministically with hand-built vectors
// (same technique as embedding-sorter.test.ts): each folder gets a one-hot
// basis vector, the thread vector's components ARE the desired cosines, and
// reference vectors are constructed in the same basis.

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

function oneHot(index: number, dim: number): number[] {
  return Array.from({ length: dim }, (_, i) => (i === index ? 1 : 0));
}

function makeMockEmbeddingProvider(
  table: ReadonlyMap<string, number[]>,
  modelName = "mock-v1"
): EmbeddingProvider {
  const dim = [...table.values()][0]?.length ?? 8;
  return {
    providerName: "mock",
    modelName,
    async embed(texts) {
      return texts.map((t) => table.get(t) ?? new Array(dim).fill(0));
    },
  };
}

function buildTable(
  nodeVectors: Array<{ node: TaxonomyNodeInput; vec: number[] }>,
  threadMessages: ThreadMessage[],
  threadVec: number[],
  allNodes: TaxonomyNodeInput[],
  allEdges: TaxonomyEdgeInput[]
): ReadonlyMap<string, number[]> {
  const map = new Map<string, number[]>();
  for (const { node, vec } of nodeVectors) {
    if (!node.isRoot && node.description) {
      const breadcrumb = deriveBreadcrumb(node.id, allNodes, allEdges);
      map.set(buildNodeEmbeddingText({ name: node.name, description: node.description, breadcrumb }), vec);
    }
  }
  const threadText = buildThreadEmbeddingText(
    threadMessages.map((m) => ({ subject: m.subject, bodyText: m.bodyText }))
  );
  map.set(threadText, threadVec);
  return map;
}

function makeLlmSpy(): { provider: AIProvider; chatSpy: ReturnType<typeof vi.fn> } {
  const chatSpy = vi.fn<() => Promise<string>>().mockResolvedValue(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );
  return { provider: { providerName: "mock", modelName: "mock-llm", chat: chatSpy }, chatSpy };
}

function msg(subject: string, bodyText: string): ThreadMessage {
  return { subject, senderEmail: "test@example.com", senderName: null, bodyText, receivedAt: new Date() };
}

// ─── Fixture: Inbox → Alpha, Beta, Gamma (one-hot 3-D basis) ───────────────────

const INBOX = n("inbox", "Inbox", null, true);
const ALPHA = n("alpha", "Alpha", "Administrative coordination and scheduling requests");
const BETA = n("beta", "Beta", "Sales inquiries, business development, and inbound lead qualification");
const GAMMA = n("gamma", "Gamma", "Finance requests, billing inquiries, and payment processing");

const NODES = [INBOX, ALPHA, BETA, GAMMA];
const EDGES = [
  e("e-inbox-alpha", "inbox", "alpha"),
  e("e-inbox-beta", "inbox", "beta"),
  e("e-inbox-gamma", "inbox", "gamma"),
];

// Borderline thread: leans Beta over Alpha. Components 0.5 (alpha) and 0.6
// (beta) normalise to cosines ≈ 0.640 / 0.768 — a 0.128 gap, comfortably above
// CROSS_BRANCH_MARGIN so the LLM stays out of these tests.
const MESSAGES = [msg("Quarterly check-in", "Scheduling the quarterly pipeline review")];
const THREAD_VEC = [0.5, 0.6, 0];

const TABLE = buildTable(
  [
    { node: ALPHA, vec: oneHot(0, 3) },
    { node: BETA, vec: oneHot(1, 3) },
    { node: GAMMA, vec: oneHot(2, 3) },
  ],
  MESSAGES,
  THREAD_VEC,
  NODES,
  EDGES
);

const embeddingProvider = makeMockEmbeddingProvider(TABLE);

// A reference identical to the thread vector: refSim = 1, the strongest
// possible human exemplar ("a thread just like this one was moved to Alpha").
const ALPHA_PERFECT_REF = [...THREAD_VEC];
// A reference orthogonal to the thread: refSim = 0, an unrelated exemplar.
const ALPHA_UNRELATED_REF = oneHot(2, 3);

function sort(options?: Parameters<typeof sortThreadByEmbedding>[5]) {
  const { provider } = makeLlmSpy();
  return sortThreadByEmbedding(embeddingProvider, provider, NODES, EDGES, MESSAGES, options);
}

describe("embedding sorter — reference-thread reinforcement", () => {
  it("routes to Beta without references (baseline)", async () => {
    const result = await sort();
    expect(result.finalNodeId).toBe("beta");
    expect(result.decisionSource).toBe("embedding_auto");
  });

  it("a strong Alpha reference flips the borderline thread to Alpha", async () => {
    const result = await sort({
      referenceVectors: new Map([["alpha", [ALPHA_PERFECT_REF]]]),
    });
    expect(result.finalNodeId).toBe("alpha");
    // Alpha's raw similarity is the weighted reference similarity (refSim = 1),
    // which beat its description similarity (~0.640).
    expect(result.rawSimilarities["alpha"]).toBeCloseTo(REFERENCE_SIM_WEIGHT, 5);
  });

  it("an absent or empty reference map leaves the result identical to the baseline", async () => {
    const baseline = await sort();
    const withEmptyMap = await sort({ referenceVectors: new Map() });
    expect(withEmptyMap.finalNodeId).toBe(baseline.finalNodeId);
    expect(withEmptyMap.rawSimilarities).toEqual(baseline.rawSimilarities);
    expect(withEmptyMap.subtreeScores).toEqual(baseline.subtreeScores);
  });

  it("referenceSimWeight 0 disables the blend (kill switch)", async () => {
    const baseline = await sort();
    const result = await sort({
      referenceVectors: new Map([["alpha", [ALPHA_PERFECT_REF]]]),
      referenceSimWeight: 0,
    });
    expect(result.finalNodeId).toBe("beta");
    expect(result.rawSimilarities).toEqual(baseline.rawSimilarities);
  });

  it("a reference can only lift a node's score, never lower it (max semantics)", async () => {
    const baseline = await sort();
    const result = await sort({
      referenceVectors: new Map([["alpha", [ALPHA_UNRELATED_REF]]]),
    });
    // The unrelated exemplar (refSim = 0) leaves Alpha's description similarity
    // in place and the routing unchanged.
    expect(result.rawSimilarities["alpha"]).toBeCloseTo(baseline.rawSimilarities["alpha"]!, 10);
    expect(result.finalNodeId).toBe("beta");
  });

  it("multiple references per node take the best match", async () => {
    const result = await sort({
      referenceVectors: new Map([["alpha", [ALPHA_UNRELATED_REF, ALPHA_PERFECT_REF]]]),
    });
    expect(result.finalNodeId).toBe("alpha");
    expect(result.rawSimilarities["alpha"]).toBeCloseTo(REFERENCE_SIM_WEIGHT, 5);
  });

  it("references for other nodes leave unrelated similarities untouched", async () => {
    const baseline = await sort();
    const result = await sort({
      referenceVectors: new Map([["alpha", [ALPHA_PERFECT_REF]]]),
    });
    expect(result.rawSimilarities["beta"]).toBeCloseTo(baseline.rawSimilarities["beta"]!, 10);
    expect(result.rawSimilarities["gamma"]).toBeCloseTo(baseline.rawSimilarities["gamma"]!, 10);
  });

  describe("mean-centered mode", () => {
    it("references are centered with the node-set centroid (a thread-identical reference still scores refSim = 1)", async () => {
      const result = await sort({
        meanCenter: true,
        referenceVectors: new Map([["alpha", [ALPHA_PERFECT_REF]]]),
      });
      // Centering subtracts the same centroid from the query and the reference,
      // so an identical vector keeps cosine 1 and Alpha's blended similarity is
      // exactly the weight.
      expect(result.rawSimilarities["alpha"]).toBeCloseTo(REFERENCE_SIM_WEIGHT, 5);
      expect(result.finalNodeId).toBe("alpha");
    });

    it("description similarities are byte-identical with and without references (centroid excludes reference vectors)", async () => {
      const baseline = await sort({ meanCenter: true });
      const result = await sort({
        meanCenter: true,
        referenceVectors: new Map([["alpha", [ALPHA_PERFECT_REF]]]),
      });
      expect(result.rawSimilarities["beta"]).toBe(baseline.rawSimilarities["beta"]);
      expect(result.rawSimilarities["gamma"]).toBe(baseline.rawSimilarities["gamma"]);
      expect(result.rawSimilarities["alpha"]).toBeGreaterThanOrEqual(
        baseline.rawSimilarities["alpha"]!
      );
    });
  });
});
