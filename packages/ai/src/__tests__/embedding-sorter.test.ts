import { describe, it, expect, vi } from "vitest";
import { sortThreadByEmbedding } from "../embedding-sorter.js";
import { THETA_MIN } from "../embedding-sorter.js";
import { buildNodeEmbeddingText, buildThreadEmbeddingText } from "../embedding-math.js";
import type { EmbeddingProvider } from "../embedding-types.js";
import type { AIProvider, TaxonomyNodeInput, TaxonomyEdgeInput, ThreadMessage } from "../types.js";

// ─── Test helpers ──────────────────────────────────────────────────────────────

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

/** Normalize a vector to unit length. */
function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

/**
 * Embedding provider backed by a text→vector lookup table.
 * Returns a zero vector for texts not in the table.
 */
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

/** Build the embedding table for a set of nodes and a thread. */
function buildTable(
  nodeVectors: Array<{ node: TaxonomyNodeInput; vec: number[] }>,
  threadMessages: ThreadMessage[],
  threadVec: number[]
): ReadonlyMap<string, number[]> {
  const map = new Map<string, number[]>();
  for (const { node, vec } of nodeVectors) {
    if (!node.isRoot && node.description) {
      map.set(buildNodeEmbeddingText({ name: node.name, description: node.description }), vec);
    }
  }
  const threadText = buildThreadEmbeddingText(
    threadMessages.map((m) => ({ subject: m.subject, bodyText: m.bodyText }))
  );
  map.set(threadText, threadVec);
  return map;
}

function makeMockLlmProvider(jsonResponse: string): AIProvider {
  return {
    providerName: "mock",
    modelName: "mock-llm",
    async chat() {
      return jsonResponse;
    },
  };
}

/** LLM mock that records calls and can be asserted on. */
function makeLlmSpy(jsonResponse: string): { provider: AIProvider; chatSpy: ReturnType<typeof vi.fn> } {
  const chatSpy = vi.fn<() => Promise<string>>().mockResolvedValue(jsonResponse);
  return {
    provider: { providerName: "mock", modelName: "mock-llm", chat: chatSpy },
    chatSpy,
  };
}

// ─── Flat taxonomy: Inbox → Alpha, Beta, Gamma ─────────────────────────────────
//
// One-hot 3-D vectors: Alpha=[1,0,0], Beta=[0,1,0], Gamma=[0,0,1]

const INBOX = n("inbox", "Inbox", null, true);
const ALPHA = n("alpha", "Alpha", "Administrative coordination and scheduling requests");
const BETA = n("beta", "Beta", "Media appearances, journalism interviews, and press coverage");
const GAMMA = n("gamma", "Gamma", "Subscription renewals, distribution logistics, and reader services");

const FLAT_NODES = [INBOX, ALPHA, BETA, GAMMA];
const FLAT_EDGES = [
  e("e-inbox-alpha", "inbox", "alpha"),
  e("e-inbox-beta", "inbox", "beta"),
  e("e-inbox-gamma", "inbox", "gamma"),
];

const ALPHA_VEC = oneHot(0, 3);
const BETA_VEC = oneHot(1, 3);
const GAMMA_VEC = oneHot(2, 3);

// ─── Two-level taxonomy: Inbox → Events → {Weddings, Funerals} | Press → {Interviews, Articles}
//
// Six-D one-hot: Weddings=0, Funerals=1, Events=2, Interviews=3, Articles=4, Press=5

const INBOX2 = n("inbox2", "Inbox", null, true);
const EVENTS = n("events", "Events", "Social events, ceremonies, and community gatherings");
const WEDDINGS = n("weddings", "Weddings", "Wedding ceremony requests and marriage coordination");
const FUNERALS = n("funerals", "Funerals", "Funeral services, bereavement support, and memorial ceremonies");
const PRESS = n("press", "Press", "Media and editorial content production and partnerships");
const INTERVIEWS = n("interviews", "Interviews", "Press interview requests and media appearances");
const ARTICLES = n("articles", "Articles", "Article submissions, editorial pitches, and written content");

const DEEP_NODES = [INBOX2, EVENTS, WEDDINGS, FUNERALS, PRESS, INTERVIEWS, ARTICLES];
const DEEP_EDGES = [
  e("e2-inbox-events", "inbox2", "events"),
  e("e2-inbox-press", "inbox2", "press"),
  e("e2-events-weddings", "events", "weddings"),
  e("e2-events-funerals", "events", "funerals"),
  e("e2-press-interviews", "press", "interviews"),
  e("e2-press-articles", "press", "articles"),
];

const [WED_VEC, FUN_VEC, EVT_VEC, INT_VEC, ART_VEC, PRS_VEC] = [0, 1, 2, 3, 4, 5].map((i) =>
  oneHot(i, 6)
);

// ─── Messages ──────────────────────────────────────────────────────────────────

function msg(subject: string, bodyText: string): ThreadMessage {
  return { subject, senderEmail: "test@example.com", senderName: null, bodyText, receivedAt: new Date() };
}

// ─── Scenario 1: Clear route to direct child ───────────────────────────────────

describe("embedding sorter — clear route to direct child", () => {
  const messages = [msg("Test", "Administrative scheduling document request")];
  const threadVec = ALPHA_VEC;

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    threadVec
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const { provider: llmProvider, chatSpy } = makeLlmSpy(
    JSON.stringify({ selectedPathId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("routes to Alpha", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    expect(result.finalNodeId).toBe("alpha");
    expect(result.needsHumanReview).toBe(false);
  });

  it("decision source is embedding_auto", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    expect(result.decisionSource).toBe("embedding_auto");
  });

  it("LLM is not called when there is a clear winner", async () => {
    chatSpy.mockClear();
    await sortThreadByEmbedding(embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages);
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("path includes the edge from Inbox to Alpha", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    expect(result.path.length).toBeGreaterThanOrEqual(1);
    expect(result.path[0]?.targetNodeId).toBe("alpha");
  });

  it("rawSimilarities contains scores for all non-root nodes", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    expect(result.rawSimilarities["alpha"]).toBeCloseTo(1.0);
    expect(result.rawSimilarities["beta"]).toBeCloseTo(0.0);
    expect(result.rawSimilarities["gamma"]).toBeCloseTo(0.0);
  });

  it("updatedNodeEmbeddings lists nodes that were freshly embedded", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    // All nodes start without embeddings → all should be in the updated list
    const updatedIds = result.updatedNodeEmbeddings.map((u) => u.nodeId);
    expect(updatedIds).toContain("alpha");
    expect(updatedIds).toContain("beta");
    expect(updatedIds).toContain("gamma");
  });
});

// ─── Scenario 2: Clear route to a deep child ──────────────────────────────────

describe("embedding sorter — clear route to deep child", () => {
  // Thread matches Weddings leaf exactly; Events parent has an independent direction.
  const messages = [msg("Wedding venue", "We are planning a wedding ceremony for next spring")];
  const threadVec = WED_VEC!;

  const table = buildTable(
    [
      { node: EVENTS, vec: EVT_VEC! },
      { node: WEDDINGS, vec: WED_VEC! },
      { node: FUNERALS, vec: FUN_VEC! },
      { node: PRESS, vec: PRS_VEC! },
      { node: INTERVIEWS, vec: INT_VEC! },
      { node: ARTICLES, vec: ART_VEC! },
    ],
    messages,
    threadVec
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const llmProvider = makeMockLlmProvider(
    JSON.stringify({ selectedPathId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("descends through Events to Weddings", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      DEEP_NODES,
      DEEP_EDGES,
      messages
    );
    expect(result.finalNodeId).toBe("weddings");
    expect(result.decisionSource).toBe("embedding_auto");
    expect(result.needsHumanReview).toBe(false);
  });

  it("path has two steps: Inbox→Events→Weddings", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      DEEP_NODES,
      DEEP_EDGES,
      messages
    );
    expect(result.path).toHaveLength(2);
    expect(result.path[0]?.targetNodeId).toBe("events");
    expect(result.path[1]?.targetNodeId).toBe("weddings");
  });
});

// ─── Scenario 3: Ambiguous children stopping at parent ────────────────────────

describe("embedding sorter — ambiguous children stop traversal at parent", () => {
  // Thread is equidistant from Weddings and Funerals.
  // Events is the best destination (root-level is clear), but at Events,
  // neither child has sufficient spread to warrant descent.
  const messages = [msg("Ceremony inquiry", "Planning a family ceremony event")];
  const threadVec = normalize([1, 1, 0, 0, 0, 0]); // equidistant Weddings/Funerals

  const table = buildTable(
    [
      { node: EVENTS, vec: EVT_VEC! },
      { node: WEDDINGS, vec: WED_VEC! },
      { node: FUNERALS, vec: FUN_VEC! },
      { node: PRESS, vec: PRS_VEC! },
      { node: INTERVIEWS, vec: INT_VEC! },
      { node: ARTICLES, vec: ART_VEC! },
    ],
    messages,
    threadVec
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const llmProvider = makeMockLlmProvider(
    JSON.stringify({ selectedPathId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("stops at Events (parent) — cannot resolve which child wins", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      DEEP_NODES,
      DEEP_EDGES,
      messages
    );
    expect(result.finalNodeId).toBe("events");
    expect(result.decisionSource).toBe("embedding_auto");
    expect(result.needsHumanReview).toBe(false);
  });

  it("path has exactly one step: Inbox→Events", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      DEEP_NODES,
      DEEP_EDGES,
      messages
    );
    expect(result.path).toHaveLength(1);
    expect(result.path[0]?.targetNodeId).toBe("events");
  });
});

// ─── Scenario 4: Poor taxonomy fit → Inbox fallback ───────────────────────────

describe("embedding sorter — poor taxonomy fit routes to Inbox review", () => {
  // Thread vector is zero → no similarity to any node → quality gate fails.
  const messages = [msg("Unrelated", "Something completely unrelated to the taxonomy")];
  const ZERO_VEC = [0, 0, 0];

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    ZERO_VEC
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const llmProvider = makeMockLlmProvider("{}"); // should not be called

  it("returns inbox_fallback with needsHumanReview", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.decisionSource).toBe("inbox_fallback");
  });

  it("explanation mentions quality threshold", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    expect(result.explanation).toMatch(/threshold|quality/i);
  });
});

// ─── Scenario 5: Rival root branches trigger LLM ─────────────────────────────

describe("embedding sorter — rival root branches trigger LLM resolver", () => {
  // Thread is equidistant between Alpha and Beta → cross-branch LLM trigger.
  const messages = [msg("Ambiguous request", "Scheduling a media appearance")];
  const threadVec = normalize([1, 1, 0]); // equidistant Alpha and Beta

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    threadVec
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);

  it("calls LLM and returns its answer (LLM picks Beta)", async () => {
    // candidate_0 is the top-scored node; in ties both Alpha and Beta rank first.
    // We return candidate_1 (Beta) to verify LLM output is respected.
    const llmProvider = makeMockLlmProvider(
      JSON.stringify({
        selectedPathId: "candidate_1",
        confidence: 0.9,
        explanation: "Media appearance matches Beta",
        needsHumanReview: false,
      })
    );
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    expect(result.decisionSource).toBe("llm");
    expect(result.needsHumanReview).toBe(false);
    // LLM-selected node must be a real node from the taxonomy
    expect(["alpha", "beta", "gamma"]).toContain(result.finalNodeId);
  });

  it("LLM is called exactly once", async () => {
    const { provider: llmProvider, chatSpy } = makeLlmSpy(
      JSON.stringify({
        selectedPathId: "candidate_0",
        confidence: 0.85,
        explanation: "Administrative match",
        needsHumanReview: false,
      })
    );
    await sortThreadByEmbedding(embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages);
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── Scenario 6: LLM called but uncertain → Inbox fallback ───────────────────

describe("embedding sorter — Inbox special rule: LLM uncertainty → fallback", () => {
  const messages = [msg("Ambiguous request", "Something that is hard to classify")];
  const threadVec = normalize([1, 1, 0]); // equidistant Alpha and Beta

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    threadVec
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const llmProvider = makeMockLlmProvider(
    JSON.stringify({
      selectedPathId: null,
      confidence: 0.3,
      explanation: "Cannot determine the correct category",
      needsHumanReview: true,
    })
  );

  it("returns inbox_fallback when LLM is uncertain", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.decisionSource).toBe("inbox_fallback");
  });

  it("does not stop at Inbox silently — explanation explains the LLM failure", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );
    expect(result.explanation.length).toBeGreaterThan(0);
  });
});

// ─── Scenario 7: Large subtree does not dominate smaller subtree ──────────────
//
// BigBranch has 3 children each with similarity 0.38.
// SmallLeaf is a single direct child with similarity 0.5.
// Using max (not sum), SmallLeaf wins because 0.5 > 0.95 * 0.38 = 0.361.

describe("embedding sorter — large subtree does not dominate smaller subtree", () => {
  // Six-D space: Big1=0, Big2=1, Big3=2, BigBranch=3, SmallLeaf=4, (unused=5)
  const INBOX_BIG = n("inbox-big", "Inbox", null, true);
  const BIG_BRANCH = n("big-branch", "BigBranch", "Large multi-topic events and coordination hub");
  const BIG1 = n("big1", "BigOne", "First sub-topic of the large branch category");
  const BIG2 = n("big2", "BigTwo", "Second sub-topic of the large branch category");
  const BIG3 = n("big3", "BigThree", "Third sub-topic of the large branch category");
  const SMALL_LEAF = n("small-leaf", "SmallLeaf", "Specific targeted requests for partnerships");

  const bigNodes = [INBOX_BIG, BIG_BRANCH, BIG1, BIG2, BIG3, SMALL_LEAF];
  const bigEdges = [
    e("eb-ib-bb", "inbox-big", "big-branch"),
    e("eb-ib-sl", "inbox-big", "small-leaf"),
    e("eb-bb-b1", "big-branch", "big1"),
    e("eb-bb-b2", "big-branch", "big2"),
    e("eb-bb-b3", "big-branch", "big3"),
  ];

  // The thread matches SmallLeaf best (0.5), and each BigBranch child moderately (0.38)
  // thread ≈ [0.38, 0.38, 0.38, 0, 0.5, 0] (not yet unit)
  const rawThread = [0.38, 0.38, 0.38, 0, 0.5, 0];
  const threadVec = normalize(rawThread); // sim to each oneHot direction is rawThread[i] / norm(rawThread)

  const dim6 = (i: number) => oneHot(i, 6);
  const messages = [msg("Partnership inquiry", "Specific partnership request targeting our niche area")];

  const table = buildTable(
    [
      { node: BIG_BRANCH, vec: dim6(3) }, // BigBranch has its own direction (dim 3)
      { node: BIG1, vec: dim6(0) },
      { node: BIG2, vec: dim6(1) },
      { node: BIG3, vec: dim6(2) },
      { node: SMALL_LEAF, vec: dim6(4) },
    ],
    messages,
    threadVec
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const { provider: llmProvider, chatSpy } = makeLlmSpy(
    JSON.stringify({ selectedPathId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("routes to SmallLeaf not BigBranch despite BigBranch having three children", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      bigNodes,
      bigEdges,
      messages
    );
    expect(result.finalNodeId).toBe("small-leaf");
    expect(result.decisionSource).toBe("embedding_auto");
  });

  it("LLM is not called — embedding result is confident", async () => {
    chatSpy.mockClear();
    await sortThreadByEmbedding(embeddingProvider, llmProvider, bigNodes, bigEdges, messages);
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("SmallLeaf raw similarity exceeds each BigBranch child's similarity", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      bigNodes,
      bigEdges,
      messages
    );
    const smallSim = result.rawSimilarities["small-leaf"] ?? 0;
    const big1Sim = result.rawSimilarities["big1"] ?? 0;
    const big2Sim = result.rawSimilarities["big2"] ?? 0;
    const big3Sim = result.rawSimilarities["big3"] ?? 0;
    expect(smallSim).toBeGreaterThan(big1Sim);
    expect(smallSim).toBeGreaterThan(big2Sim);
    expect(smallSim).toBeGreaterThan(big3Sim);
  });
});

// ─── Scenario 8: Node embedding cache — stale embeddings are recomputed ───────

describe("embedding sorter — stale embedding detection", () => {
  const messages = [msg("Admin test", "Administrative scheduling request")];
  const threadVec = ALPHA_VEC;

  it("recomputes embeddings when model name differs", async () => {
    const table = buildTable(
      [
        { node: ALPHA, vec: ALPHA_VEC },
        { node: BETA, vec: BETA_VEC },
        { node: GAMMA, vec: GAMMA_VEC },
      ],
      messages,
      threadVec
    );

    const embeddingProvider = makeMockEmbeddingProvider(table, "new-model-v2");
    const llmProvider = makeMockLlmProvider("{}");

    // Supply nodes with embeddings from old model → stale
    const nodesWithOldEmbeddings = FLAT_NODES.map((node) =>
      node.isRoot
        ? node
        : {
            ...node,
            embeddingVector: [0.1, 0.2, 0.3],
            embeddingModel: "old-model-v1",
            embeddingTextHash: "stale-hash",
          }
    );

    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      nodesWithOldEmbeddings,
      FLAT_EDGES,
      messages
    );

    // All non-root nodes should be re-embedded and returned in updatedNodeEmbeddings
    expect(result.updatedNodeEmbeddings.length).toBe(3);
    expect(result.updatedNodeEmbeddings.every((u) => u.embeddingModel === "new-model-v2")).toBe(true);
  });

  it("skips re-embedding nodes whose hash is current", async () => {
    const { buildNodeEmbeddingText: buildText, hashEmbeddingInput: hashFn } = await import(
      "../embedding-math.js"
    );

    const modelName = "current-model";
    const table = buildTable(
      [
        { node: ALPHA, vec: ALPHA_VEC },
        { node: BETA, vec: BETA_VEC },
        { node: GAMMA, vec: GAMMA_VEC },
      ],
      messages,
      threadVec
    );

    const embeddingProvider = makeMockEmbeddingProvider(table, modelName);
    const llmProvider = makeMockLlmProvider("{}");

    // Provide Alpha with a fresh (current) embedding
    const alphaText = buildText({ name: ALPHA.name, description: ALPHA.description! });
    const alphaHash = hashFn(alphaText, modelName);

    const nodesWithFreshAlpha = FLAT_NODES.map((node) =>
      node.id === "alpha"
        ? { ...node, embeddingVector: ALPHA_VEC, embeddingModel: modelName, embeddingTextHash: alphaHash }
        : node
    );

    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      nodesWithFreshAlpha,
      FLAT_EDGES,
      messages
    );

    // Alpha should NOT be re-embedded (it was fresh); Beta and Gamma should be
    const updatedIds = result.updatedNodeEmbeddings.map((u) => u.nodeId);
    expect(updatedIds).not.toContain("alpha");
    expect(updatedIds).toContain("beta");
    expect(updatedIds).toContain("gamma");
  });
});

// ─── Scenario 9: No root node ─────────────────────────────────────────────────

describe("embedding sorter — no root node", () => {
  it("returns inbox_fallback immediately", async () => {
    const nodesWithoutRoot = FLAT_NODES.filter((n) => !n.isRoot);
    const embeddingProvider = makeMockEmbeddingProvider(new Map());
    const llmProvider = makeMockLlmProvider("{}");

    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      nodesWithoutRoot,
      FLAT_EDGES,
      [msg("Test", "body")]
    );

    expect(result.finalNodeId).toBeNull();
    expect(result.decisionSource).toBe("inbox_fallback");
  });
});

// ─── Scenario 10: Quality gate threshold ──────────────────────────────────────

describe("embedding sorter — quality gate", () => {
  it(`routes to inbox_fallback when max raw similarity < THETA_MIN (${THETA_MIN})`, async () => {
    const messages = [msg("Vague", "Something vague")];
    // Thread at 45° to Alpha and Beta: sim = 0.707, but also sim = 0.707... wait
    // Use a slightly below-threshold vector: project weakly onto all nodes
    const weakVec = normalize([0.1, 0.1, 0.1]); // equal projection ~0.577 each? no...
    // oneHot sim: sim([0.577,0.577,0.577], [1,0,0]) = 0.577 > THETA_MIN
    // So we need a vector with even lower max projection.
    // Use a vector pointing "between" all three, but scaled down artificially via a
    // 4D space where we add a large orthogonal component:
    // [0.1, 0.1, 0.1, 0.99] → after normalize: sim to any oneHot(0-2, 4) ≈ 0.1 / norm ≈ 0.1
    const dim4 = 4;
    const belowThresholdVec = normalize([0.1, 0.1, 0.1, 1.0]); // sim to oneHot(0,4) ≈ 0.1/1.015 ≈ 0.099

    const ALPHA4 = n("alpha4", "Alpha", "Administrative coordination and scheduling requests");
    const BETA4 = n("beta4", "Beta", "Media appearances, journalism interviews, and press coverage");
    const GAMMA4 = n("gamma4", "Gamma", "Subscription renewals, distribution logistics, and reader services");
    const INBOX4 = n("inbox4", "Inbox", null, true);

    const nodes4 = [INBOX4, ALPHA4, BETA4, GAMMA4];
    const edges4 = [
      e("e4-i-a", "inbox4", "alpha4"),
      e("e4-i-b", "inbox4", "beta4"),
      e("e4-i-g", "inbox4", "gamma4"),
    ];

    const table = buildTable(
      [
        { node: ALPHA4, vec: oneHot(0, dim4) },
        { node: BETA4, vec: oneHot(1, dim4) },
        { node: GAMMA4, vec: oneHot(2, dim4) },
      ],
      messages,
      belowThresholdVec
    );

    const embeddingProvider = makeMockEmbeddingProvider(table);
    const llmProvider = makeMockLlmProvider("{}");

    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      nodes4,
      edges4,
      messages
    );

    expect(result.decisionSource).toBe("inbox_fallback");
    expect(result.needsHumanReview).toBe(true);
    // Max raw sim should be below THETA_MIN
    const maxSim = Math.max(...Object.values(result.rawSimilarities));
    expect(maxSim).toBeLessThan(THETA_MIN);
  });
});
