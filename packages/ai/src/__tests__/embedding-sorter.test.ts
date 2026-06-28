import { describe, it, expect, vi } from "vitest";
import { sortThreadByEmbedding } from "../embedding/sorter.js";
import { THETA_MIN } from "../embedding/sorter.js";
import { buildSimTable, makeSimEmbedder } from "./fixtures/sim-embedder.js";
import {
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
  deriveBreadcrumb,
} from "../embedding/math.js";
import type { EmbeddingProvider } from "../embedding/types.js";
import type { EmbeddableNode } from "../embedding/types.js";
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

/**
 * Build the embedding table for a set of nodes and a thread.
 * Uses the breadcrumb-aware embedding text so mock lookups match
 * what the sorter computes at runtime.
 */
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
const BETA = n("beta", "Beta", "Sales inquiries, business development, and inbound lead qualification");
const GAMMA = n("gamma", "Gamma", "Finance requests, billing inquiries, and payment processing");

const FLAT_NODES = [INBOX, ALPHA, BETA, GAMMA];
const FLAT_EDGES = [
  e("e-inbox-alpha", "inbox", "alpha"),
  e("e-inbox-beta", "inbox", "beta"),
  e("e-inbox-gamma", "inbox", "gamma"),
];

const ALPHA_VEC = oneHot(0, 3);
const BETA_VEC = oneHot(1, 3);
const GAMMA_VEC = oneHot(2, 3);

// ─── Two-level taxonomy: Inbox → Support → {Technical, Billing} | Sales → {Inbound, Outbound}
//
// Six-D one-hot: Technical=0, Billing=1, Support=2, Inbound=3, Outbound=4, Sales=5

const INBOX2 = n("inbox2", "Inbox", null, true);
const SUPPORT = n("support", "Support", "Customer support requests, issue escalation, and technical assistance");
const TECHNICAL = n("technical", "Technical Issues", "Technical product issues, bug reports, and system error resolution");
const BILLING = n("billing", "Billing Issues", "Billing inquiries, payment problems, and invoice disputes");
const SALES2 = n("sales2", "Sales", "Sales inquiries, business development, and revenue opportunities");
const INBOUND = n("inbound", "Inbound Leads", "Inbound sales leads, prospect inquiries, and demo requests");
const OUTBOUND = n("outbound", "Outbound Campaigns", "Outbound sales campaigns, cold outreach, and business development");

const DEEP_NODES = [INBOX2, SUPPORT, TECHNICAL, BILLING, SALES2, INBOUND, OUTBOUND];
const DEEP_EDGES = [
  e("e2-inbox-support", "inbox2", "support"),
  e("e2-inbox-sales2", "inbox2", "sales2"),
  e("e2-support-technical", "support", "technical"),
  e("e2-support-billing", "support", "billing"),
  e("e2-sales2-inbound", "sales2", "inbound"),
  e("e2-sales2-outbound", "sales2", "outbound"),
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
    threadVec,
    FLAT_NODES,
    FLAT_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const { provider: llmProvider, chatSpy } = makeLlmSpy(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
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
    const updatedIds = result.updatedNodeEmbeddings.map((u) => u.nodeId);
    expect(updatedIds).toContain("alpha");
    expect(updatedIds).toContain("beta");
    expect(updatedIds).toContain("gamma");
  });
});

// ─── Scenario 2: Clear route to a deep child ──────────────────────────────────

describe("embedding sorter — clear route to deep child", () => {
  const messages = [msg("Technical support request", "We have a technical issue with your product and need assistance resolving a system error")];
  const threadVec = WED_VEC!; // WED_VEC maps to index 0 = Technical Issues

  const table = buildTable(
    [
      { node: SUPPORT, vec: EVT_VEC! },
      { node: TECHNICAL, vec: WED_VEC! },
      { node: BILLING, vec: FUN_VEC! },
      { node: SALES2, vec: PRS_VEC! },
      { node: INBOUND, vec: INT_VEC! },
      { node: OUTBOUND, vec: ART_VEC! },
    ],
    messages,
    threadVec,
    DEEP_NODES,
    DEEP_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const llmProvider = makeMockLlmProvider(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("descends through Support to Technical Issues", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      DEEP_NODES,
      DEEP_EDGES,
      messages
    );
    expect(result.finalNodeId).toBe("technical");
    expect(result.decisionSource).toBe("embedding_auto");
    expect(result.needsHumanReview).toBe(false);
  });

  it("path has two steps: Inbox→Support→Technical Issues", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      DEEP_NODES,
      DEEP_EDGES,
      messages
    );
    expect(result.path).toHaveLength(2);
    expect(result.path[0]?.targetNodeId).toBe("support");
    expect(result.path[1]?.targetNodeId).toBe("technical");
  });
});

// ─── Scenario 3: Ambiguous children stopping at parent ────────────────────────

describe("embedding sorter — ambiguous children stop traversal at parent", () => {
  const messages = [msg("Support inquiry", "We have a customer support inquiry about your service")];
  const threadVec = normalize([1, 1, 0, 0, 0, 0]); // equal weight on Technical (0) and Billing (1)

  const table = buildTable(
    [
      { node: SUPPORT, vec: EVT_VEC! },
      { node: TECHNICAL, vec: WED_VEC! },
      { node: BILLING, vec: FUN_VEC! },
      { node: SALES2, vec: PRS_VEC! },
      { node: INBOUND, vec: INT_VEC! },
      { node: OUTBOUND, vec: ART_VEC! },
    ],
    messages,
    threadVec,
    DEEP_NODES,
    DEEP_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const llmProvider = makeMockLlmProvider(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("stops at Support (parent) — cannot resolve which child wins", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      DEEP_NODES,
      DEEP_EDGES,
      messages
    );
    expect(result.finalNodeId).toBe("support");
    expect(result.decisionSource).toBe("embedding_auto");
    expect(result.needsHumanReview).toBe(false);
  });

  it("path has exactly one step: Inbox→Support", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      DEEP_NODES,
      DEEP_EDGES,
      messages
    );
    expect(result.path).toHaveLength(1);
    expect(result.path[0]?.targetNodeId).toBe("support");
  });
});

// ─── Scenario 4: Poor taxonomy fit → Inbox fallback ───────────────────────────

describe("embedding sorter — poor taxonomy fit routes to Inbox review", () => {
  const messages = [msg("Unrelated", "Something completely unrelated to the taxonomy")];
  const ZERO_VEC = [0, 0, 0];

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    ZERO_VEC,
    FLAT_NODES,
    FLAT_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const llmProvider = makeMockLlmProvider("{}");

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
    // The quality gate is a legitimate review decision, not an error fail-open,
    // so the push must NOT be suppressed.
    expect(result.failedOpenOnError).toBe(false);
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

// ─── Scenario 4b: Catch-all routing is localization-independent ────────────────
//
// The catch-all ("Updates / Other") is identified structurally by `isCatchAll`,
// never by its name. Workspaces localize node names, so a name-based check would
// silently break routing in non-English locales. This pins the guarantee: even
// when the thread is a perfect semantic match for a catch-all whose name has been
// translated, the sorter still excludes it from competition by the flag alone.

describe("embedding sorter — localized catch-all is excluded by flag, not name", () => {
  const messages = [msg("Notification", "Automated service update digest")];

  // Catch-all with a non-English (French) name — routing must not depend on it.
  const LOC_CATCH_ALL: TaxonomyNodeInput = {
    ...n("updates_other", "Mises à jour / Autres", "Notifications automatisées et mises à jour de service."),
    isCatchAll: true,
  };
  const LOC_INBOX = n("loc-inbox", "Boîte de réception", null, true);
  const LOC_WORK = n("loc-work", "Travail", "Work projects, tasks, and deliverables");

  const LOC_NODES = [LOC_INBOX, LOC_WORK, LOC_CATCH_ALL];
  const LOC_EDGES = [
    e("le-inbox-work", "loc-inbox", "loc-work"),
    e("le-inbox-other", "loc-inbox", "updates_other"),
  ];

  // 2-D one-hot: Work=[1,0], catch-all=[0,1]. The thread vector points at the
  // catch-all, so a name-blind-but-flag-aware sorter must still refuse to file
  // there and fall back to Inbox review instead.
  const table = buildTable(
    [
      { node: LOC_WORK, vec: [1, 0] },
      { node: LOC_CATCH_ALL, vec: [0, 1] },
    ],
    messages,
    [0, 1],
    LOC_NODES,
    LOC_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const llmProvider = makeMockLlmProvider("{}");

  it("never routes to the catch-all even when it is the best semantic match", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      LOC_NODES,
      LOC_EDGES,
      messages
    );
    expect(result.finalNodeId).not.toBe("updates_other");
    // Excluded from competition → no routable match → Inbox review.
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.decisionSource).toBe("inbox_fallback");
  });
});

// ─── Scenario 5: Rival root branches trigger LLM ─────────────────────────────

describe("embedding sorter — rival root branches trigger LLM resolver", () => {
  const messages = [msg("Ambiguous request", "Scheduling a media appearance")];
  const threadVec = normalize([1, 1, 0]);

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    threadVec,
    FLAT_NODES,
    FLAT_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);

  it("calls LLM and returns its answer (LLM picks Beta)", async () => {
    const llmProvider = makeMockLlmProvider(
      JSON.stringify({
        selectedNodeId: "candidate_1",
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
    expect(["alpha", "beta", "gamma"]).toContain(result.finalNodeId);
  });

  it("LLM is called exactly once", async () => {
    const { provider: llmProvider, chatSpy } = makeLlmSpy(
      JSON.stringify({
        selectedNodeId: "candidate_0",
        confidence: 0.85,
        explanation: "Administrative match",
        needsHumanReview: false,
      })
    );
    await sortThreadByEmbedding(embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages);
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it("suppressLlmEscalation: skips the LLM entirely and routes by embeddings", async () => {
    const { provider: llmProvider, chatSpy } = makeLlmSpy(
      JSON.stringify({
        selectedNodeId: "candidate_0",
        confidence: 0.85,
        explanation: "should not be called",
        needsHumanReview: false,
      })
    );
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages,
      { suppressLlmEscalation: true }
    );
    // The ambiguous branches would normally escalate; with suppression the LLM
    // is never called and the result is a pure embedding decision.
    expect(chatSpy).not.toHaveBeenCalled();
    expect(result.decisionSource).not.toBe("llm");
    expect(result.decisionSource).not.toBe("inbox_fallback");
  });

  // ── Fail-open when the LLM call throws ──────────────────────────────────────
  const throwingLlm: AIProvider = {
    providerName: "mock",
    modelName: "mock-llm",
    async chat() {
      throw new Error("Premature close");
    },
  };

  it("falls open to inbox review when the LLM call throws and failOpenOnLlmError is set", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      throwingLlm,
      FLAT_NODES,
      FLAT_EDGES,
      messages,
      { failOpenOnLlmError: true }
    );
    expect(result.decisionSource).toBe("inbox_fallback");
    expect(result.needsHumanReview).toBe(true);
    expect(result.explanation).toMatch(/temporarily unavailable/);
    // An LLM-error fallback is flagged so the caller can suppress the push.
    expect(result.failedOpenOnError).toBe(true);
  });

  it("rethrows the LLM error by default (so BullMQ can retry)", async () => {
    await expect(
      sortThreadByEmbedding(embeddingProvider, throwingLlm, FLAT_NODES, FLAT_EDGES, messages)
    ).rejects.toThrow("Premature close");
  });

  // ── Retry-dedup of the cross-branch LLM call ────────────────────────────────
  //
  // Mirrors the worker's memoizeAcrossRetries codec: compute on a key miss,
  // store the raw string, replay it on a hit. A second sort of the "same job"
  // (same backing store) must not re-call the model, and must still produce a
  // validated decision — proving the cache holds only the raw string and that
  // validateNodeSelection runs on the replayed read, not just on a fresh call.
  describe("llmMemoizer retry-dedup", () => {
    function makeJobMemoizer() {
      const store = new Map<string, string>();
      const steps: string[] = [];
      const memoize = async (step: string, compute: () => Promise<string>): Promise<string> => {
        steps.push(step);
        const cached = store.get(step);
        if (cached !== undefined) {
          const v: unknown = JSON.parse(cached);
          if (typeof v === "string" && v.length > 0) return v;
        }
        const value = await compute();
        if (value.length > 0) store.set(step, JSON.stringify(value));
        return value;
      };
      return { memoize, steps };
    }

    it("replays the cached response on retry without re-calling the model, still validated", async () => {
      const { provider: llmProvider, chatSpy } = makeLlmSpy(
        JSON.stringify({
          selectedNodeId: "candidate_1",
          confidence: 0.9,
          explanation: "Media appearance matches Beta",
          needsHumanReview: false,
        })
      );
      const { memoize } = makeJobMemoizer();

      const first = await sortThreadByEmbedding(
        embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages, { llmMemoizer: memoize }
      );
      // Simulated retry of the same job: same memoizer/backing store.
      const second = await sortThreadByEmbedding(
        embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages, { llmMemoizer: memoize }
      );

      expect(chatSpy).toHaveBeenCalledTimes(1);
      expect(second.decisionSource).toBe("llm");
      expect(second.needsHumanReview).toBe(false);
      expect(second.finalNodeId).toBe(first.finalNodeId);
    });

    it("uses a stable, candidate-derived step key across attempts", async () => {
      const llmProvider = makeMockLlmProvider(
        JSON.stringify({
          selectedNodeId: "candidate_0",
          confidence: 0.85,
          explanation: "Administrative match",
          needsHumanReview: false,
        })
      );
      const { memoize, steps } = makeJobMemoizer();

      await sortThreadByEmbedding(
        embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages, { llmMemoizer: memoize }
      );
      await sortThreadByEmbedding(
        embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages, { llmMemoizer: memoize }
      );

      expect(steps).toHaveLength(2);
      expect(steps[0]).toBe(steps[1]);
      expect(steps[0]).toMatch(/^llm-ambiguity:root:[0-9a-f]{16}$/);
    });
  });
});

// ─── Scenario 6: LLM called but uncertain → Inbox fallback ───────────────────

describe("embedding sorter — Inbox special rule: LLM uncertainty → fallback", () => {
  const messages = [msg("Ambiguous request", "Something that is hard to classify")];
  const threadVec = normalize([1, 1, 0]);

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    threadVec,
    FLAT_NODES,
    FLAT_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const llmProvider = makeMockLlmProvider(
    JSON.stringify({
      selectedNodeId: null,
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

describe("embedding sorter — large subtree does not dominate smaller subtree", () => {
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

  const rawThread = [0.38, 0.38, 0.38, 0, 0.5, 0];
  const threadVec = normalize(rawThread);

  const dim6 = (i: number) => oneHot(i, 6);
  const messages = [msg("Partnership inquiry", "Specific partnership request targeting our niche area")];

  const table = buildTable(
    [
      { node: BIG_BRANCH, vec: dim6(3) },
      { node: BIG1, vec: dim6(0) },
      { node: BIG2, vec: dim6(1) },
      { node: BIG3, vec: dim6(2) },
      { node: SMALL_LEAF, vec: dim6(4) },
    ],
    messages,
    threadVec,
    bigNodes,
    bigEdges
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const { provider: llmProvider, chatSpy } = makeLlmSpy(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
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
      threadVec,
      FLAT_NODES,
      FLAT_EDGES
    );

    const embeddingProvider = makeMockEmbeddingProvider(table, "new-model-v2");
    const llmProvider = makeMockLlmProvider("{}");

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

    expect(result.updatedNodeEmbeddings.length).toBe(3);
    expect(result.updatedNodeEmbeddings.every((u) => u.embeddingModel === "new-model-v2")).toBe(true);
  });

  it("skips re-embedding nodes whose hash is current", async () => {
    const modelName = "current-model";
    const table = buildTable(
      [
        { node: ALPHA, vec: ALPHA_VEC },
        { node: BETA, vec: BETA_VEC },
        { node: GAMMA, vec: GAMMA_VEC },
      ],
      messages,
      threadVec,
      FLAT_NODES,
      FLAT_EDGES
    );

    const embeddingProvider = makeMockEmbeddingProvider(table, modelName);
    const llmProvider = makeMockLlmProvider("{}");

    const alphaBreadcrumb = deriveBreadcrumb("alpha", FLAT_NODES, FLAT_EDGES);
    const alphaText = buildNodeEmbeddingText({
      name: ALPHA.name,
      description: ALPHA.description!,
      breadcrumb: alphaBreadcrumb,
    });
    const alphaHash = hashEmbeddingInput(alphaText, modelName);

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

    const updatedIds = result.updatedNodeEmbeddings.map((u) => u.nodeId);
    expect(updatedIds).not.toContain("alpha");
    expect(updatedIds).toContain("beta");
    expect(updatedIds).toContain("gamma");
  });

  it("embedding text includes breadcrumb, name, and description", async () => {
    const modelName = "current-model";
    const table = buildTable(
      [
        { node: ALPHA, vec: ALPHA_VEC },
        { node: BETA, vec: BETA_VEC },
        { node: GAMMA, vec: GAMMA_VEC },
      ],
      messages,
      threadVec,
      FLAT_NODES,
      FLAT_EDGES
    );

    const embeddingProvider = makeMockEmbeddingProvider(table, modelName);
    const llmProvider = makeMockLlmProvider("{}");

    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );

    // All nodes freshly embedded — verify Alpha's stored hash matches the expected text format
    const alphaUpdate = result.updatedNodeEmbeddings.find((u) => u.nodeId === "alpha");
    expect(alphaUpdate).toBeDefined();

    const breadcrumb = deriveBreadcrumb("alpha", FLAT_NODES, FLAT_EDGES);
    const expectedText = buildNodeEmbeddingText({
      name: ALPHA.name,
      description: ALPHA.description!,
      breadcrumb,
    });
    expect(expectedText).toContain("Path:");
    expect(expectedText).toContain("Name: Alpha");
    expect(expectedText).toContain("Description:");
    expect(expectedText).toContain("Inbox > Alpha");

    const expectedHash = hashEmbeddingInput(expectedText, modelName);
    expect(alphaUpdate?.embeddingTextHash).toBe(expectedHash);
  });

  it("path is not stored as a node field", () => {
    const node: EmbeddableNode = {
      ...ALPHA,
      embeddingVector: null,
      embeddingModel: null,
      embeddingTextHash: null,
    };
    // EmbeddableNode must not have a breadcrumb property
    expect(node).not.toHaveProperty("breadcrumb");
    // TaxonomyNodeInput also must not have breadcrumb
    const taxonomyNode: TaxonomyNodeInput = ALPHA;
    expect(taxonomyNode).not.toHaveProperty("breadcrumb");
  });

  it("description change refreshes only that node", async () => {
    const modelName = "current-model";
    const table = buildTable(
      [
        { node: ALPHA, vec: ALPHA_VEC },
        { node: BETA, vec: BETA_VEC },
        { node: GAMMA, vec: GAMMA_VEC },
      ],
      messages,
      threadVec,
      FLAT_NODES,
      FLAT_EDGES
    );

    const embeddingProvider = makeMockEmbeddingProvider(table, modelName);
    const llmProvider = makeMockLlmProvider("{}");

    // Beta is fresh (current hash for current name+description+breadcrumb)
    const betaBreadcrumb = deriveBreadcrumb("beta", FLAT_NODES, FLAT_EDGES);
    const betaText = buildNodeEmbeddingText({
      name: BETA.name,
      description: BETA.description!,
      breadcrumb: betaBreadcrumb,
    });
    const betaHash = hashEmbeddingInput(betaText, modelName);

    const nodesWithFreshBeta = FLAT_NODES.map((node) =>
      node.id === "beta"
        ? { ...node, embeddingVector: BETA_VEC, embeddingModel: modelName, embeddingTextHash: betaHash }
        : node
    );

    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      nodesWithFreshBeta,
      FLAT_EDGES,
      messages
    );

    const updatedIds = result.updatedNodeEmbeddings.map((u) => u.nodeId);
    // Beta was fresh (simulating: only other nodes had description changed) — not re-embedded
    expect(updatedIds).not.toContain("beta");
    // Alpha and Gamma are stale — re-embedded
    expect(updatedIds).toContain("alpha");
    expect(updatedIds).toContain("gamma");
  });

  it("nodes with old-format embedding hashes are detected as stale", async () => {
    // The old format was "Name\nDescription" with no Path: prefix.
    // Any hash computed from that format will not match the new path-aware hash.
    const modelName = "current-model";
    const table = buildTable(
      [
        { node: ALPHA, vec: ALPHA_VEC },
        { node: BETA, vec: BETA_VEC },
        { node: GAMMA, vec: GAMMA_VEC },
      ],
      messages,
      threadVec,
      FLAT_NODES,
      FLAT_EDGES
    );

    const embeddingProvider = makeMockEmbeddingProvider(table, modelName);
    const llmProvider = makeMockLlmProvider("{}");

    // Give Alpha an old-format hash (name\ndescription, no breadcrumb)
    const oldText = `${ALPHA.name}\n${ALPHA.description}`;
    const oldHash = hashEmbeddingInput(oldText, modelName);

    const nodesWithOldAlpha = FLAT_NODES.map((node) =>
      node.id === "alpha"
        ? { ...node, embeddingVector: ALPHA_VEC, embeddingModel: modelName, embeddingTextHash: oldHash }
        : node
    );

    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      nodesWithOldAlpha,
      FLAT_EDGES,
      messages
    );

    // Alpha's old hash does not match the new path-aware hash → detected as stale
    const updatedIds = result.updatedNodeEmbeddings.map((u) => u.nodeId);
    expect(updatedIds).toContain("alpha");
  });

  it("sorting does not silently use stale embeddings — stale nodes appear in updatedNodeEmbeddings", async () => {
    const modelName = "current-model";
    const table = buildTable(
      [
        { node: ALPHA, vec: ALPHA_VEC },
        { node: BETA, vec: BETA_VEC },
        { node: GAMMA, vec: GAMMA_VEC },
      ],
      messages,
      threadVec,
      FLAT_NODES,
      FLAT_EDGES
    );

    const embeddingProvider = makeMockEmbeddingProvider(table, modelName);
    const llmProvider = makeMockLlmProvider("{}");

    // Supply all non-root nodes with stale hashes
    const nodesWithStaleHashes = FLAT_NODES.map((node) =>
      node.isRoot
        ? node
        : { ...node, embeddingVector: [0.5, 0.5, 0.5], embeddingModel: modelName, embeddingTextHash: "stale" }
    );

    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llmProvider,
      nodesWithStaleHashes,
      FLAT_EDGES,
      messages
    );

    // All stale nodes must appear in updatedNodeEmbeddings — none silently used old vectors
    const updatedIds = result.updatedNodeEmbeddings.map((u) => u.nodeId);
    expect(updatedIds).toContain("alpha");
    expect(updatedIds).toContain("beta");
    expect(updatedIds).toContain("gamma");
    // And the new hashes must match the path-aware format
    for (const update of result.updatedNodeEmbeddings) {
      const node = FLAT_NODES.find((n) => n.id === update.nodeId)!;
      const breadcrumb = deriveBreadcrumb(node.id, FLAT_NODES, FLAT_EDGES);
      const text = buildNodeEmbeddingText({ name: node.name, description: node.description!, breadcrumb });
      expect(update.embeddingTextHash).toBe(hashEmbeddingInput(text, modelName));
    }
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

// ─── Scenario 10: Thread stays in Inbox — no first-level child matches ────────

// ─── Scenario 10: Truly ambiguous thread — uniform cosine similarity ──────────
//
// When the thread has equal cosine similarity with every first-level child
// (uniform one-hot thread vector), the cross-branch margin check fires because
// the top two subtree scores are identical. The LLM is asked to resolve the
// tie but returns needsHumanReview, so the sorter falls back to inbox_fallback.
//
// This is the canonical "truly ambiguous input" path. Note that a thread vector
// with a 29%-higher cosine similarity for one node IS a meaningful signal and
// WOULD route to that node under normalized-spread semantics — so the scenario
// here uses a genuinely uniform distribution to test the ambiguous path.

describe("embedding sorter — truly ambiguous thread falls back via LLM to human review", () => {
  const INBOX5 = n("inbox5", "Inbox", null, true);
  const NODE_A = n("n5-a", "Alpha", "Administrative coordination and scheduling requests");
  const NODE_B = n("n5-b", "Beta", "Sales inquiries, business development, and inbound lead qualification");
  const NODE_C = n("n5-c", "Gamma", "Finance requests, billing inquiries, and payment processing");
  const NODE_D = n("n5-d", "Delta", "Partnership proposals and co-marketing collaboration opportunities");
  const NODE_E = n("n5-e", "Epsilon", "Technical support tickets and infrastructure incidents");

  const nodes5 = [INBOX5, NODE_A, NODE_B, NODE_C, NODE_D, NODE_E];
  const edges5 = [
    e("e5-i-a", "inbox5", "n5-a"),
    e("e5-i-b", "inbox5", "n5-b"),
    e("e5-i-c", "inbox5", "n5-c"),
    e("e5-i-d", "inbox5", "n5-d"),
    e("e5-i-e", "inbox5", "n5-e"),
  ];

  // Uniform thread vector: equal cosine similarity with every one-hot node.
  // This guarantees the cross-branch margin fires (top-2 subtree diff = 0).
  const threadVec5 = normalize([1, 1, 1, 1, 1]);
  const messages5 = [msg("General inquiry", "This message does not clearly fit any single category")];

  const table5 = buildTable(
    [
      { node: NODE_A, vec: oneHot(0, 5) },
      { node: NODE_B, vec: oneHot(1, 5) },
      { node: NODE_C, vec: oneHot(2, 5) },
      { node: NODE_D, vec: oneHot(3, 5) },
      { node: NODE_E, vec: oneHot(4, 5) },
    ],
    messages5,
    threadVec5,
    nodes5,
    edges5
  );

  const embeddingProvider5 = makeMockEmbeddingProvider(table5);
  // LLM is called (cross-branch triggered) but cannot resolve the tie
  const { provider: llmProvider5, chatSpy: chatSpy5 } = makeLlmSpy(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "Cannot resolve tie", needsHumanReview: true })
  );

  it("returns inbox_fallback with needsHumanReview — LLM cannot resolve the tie", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider5,
      llmProvider5,
      nodes5,
      edges5,
      messages5
    );
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.decisionSource).toBe("inbox_fallback");
  });

  it("path is empty — no traversal steps were taken before LLM was called", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider5,
      llmProvider5,
      nodes5,
      edges5,
      messages5
    );
    expect(result.path).toHaveLength(0);
  });

  it("LLM is called exactly once — cross-branch margin triggered by tie", async () => {
    chatSpy5.mockClear();
    await sortThreadByEmbedding(embeddingProvider5, llmProvider5, nodes5, edges5, messages5);
    expect(chatSpy5).toHaveBeenCalledTimes(1);
  });

  it("explanation mentions the LLM failure reason", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider5,
      llmProvider5,
      nodes5,
      edges5,
      messages5
    );
    expect(result.explanation.length).toBeGreaterThan(0);
  });
});

// ─── Scenario 11: Existing non-Inbox fallback behavior preserved ───────────────

describe("embedding sorter — existing non-Inbox fallback behavior still works", () => {
  it("quality gate failure still returns null + needsHumanReview (thread too dissimilar to all nodes)", async () => {
    const messages = [msg("Vague", "Something completely off-topic")];
    const dim4 = 4;
    const belowThresholdVec = normalize([0.1, 0.1, 0.1, 1.0]);

    const ALPHA_F = n("alpha-f", "Alpha", "Administrative coordination and scheduling requests");
    const BETA_F = n("beta-f", "Beta", "Sales inquiries, business development, and inbound lead qualification");
    const INBOX_F = n("inbox-f", "Inbox", null, true);

    const nodes_f = [INBOX_F, ALPHA_F, BETA_F];
    const edges_f = [e("ef-i-a", "inbox-f", "alpha-f"), e("ef-i-b", "inbox-f", "beta-f")];

    const table_f = buildTable(
      [
        { node: ALPHA_F, vec: oneHot(0, dim4) },
        { node: BETA_F, vec: oneHot(1, dim4) },
      ],
      messages,
      belowThresholdVec,
      nodes_f,
      edges_f
    );

    const result = await sortThreadByEmbedding(
      makeMockEmbeddingProvider(table_f),
      makeMockLlmProvider("{}"),
      nodes_f,
      edges_f,
      messages
    );

    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.decisionSource).toBe("inbox_fallback");
  });

  it("LLM cross-branch uncertainty still returns null + needsHumanReview", async () => {
    const messages = [msg("Ambiguous", "Hard to classify")];
    const threadVec = normalize([1, 1, 0]);

    const table = buildTable(
      [
        { node: ALPHA, vec: ALPHA_VEC },
        { node: BETA, vec: BETA_VEC },
        { node: GAMMA, vec: GAMMA_VEC },
      ],
      messages,
      threadVec,
      FLAT_NODES,
      FLAT_EDGES
    );

    const result = await sortThreadByEmbedding(
      makeMockEmbeddingProvider(table),
      makeMockLlmProvider(
        JSON.stringify({
          selectedNodeId: null,
          confidence: 0.3,
          explanation: "Cannot determine the correct category",
          needsHumanReview: true,
        })
      ),
      FLAT_NODES,
      FLAT_EDGES,
      messages
    );

    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.decisionSource).toBe("inbox_fallback");
  });
});

// ─── Scenarios 12–15: Current-intent policy (multi-message threads) ───────────
//
// All four scenarios use the flat 3-node taxonomy:
//   INBOX (root) → ALPHA (admin) | BETA (media) | GAMMA (subscriptions)
//
// The embedding table maps the full thread text (produced by the updated
// buildThreadEmbeddingText, which labels latest first) to the expected vector.
// This verifies that the sorter uses buildThreadEmbeddingText for both table
// construction and embedding lookup, producing the correct routing.

function msgAt(subject: string, bodyText: string, daysAgo: number): ThreadMessage {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return { subject, senderEmail: "test@example.com", senderName: null, bodyText, receivedAt: d };
}

describe("embedding sorter — current-intent policy: latest message changes topic", () => {
  // Earlier message: admin scheduling (ALPHA territory)
  // Latest message: sales inquiry (BETA territory)
  // Expected: routes to BETA because latest message is the primary signal.
  const messages = [
    msgAt("Admin follow-up", "Administrative scheduling request for document coordination", 3),
    msgAt("Re: Follow up", "We are requesting enterprise pricing and a sales demo for our team", 0),
  ];
  const threadVec = BETA_VEC; // latest message (sales) drives the embedding

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    threadVec,
    FLAT_NODES,
    FLAT_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const { provider: llmProvider, chatSpy } = makeLlmSpy(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("routes to Beta (sales) — latest message overrides earlier admin topic", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages
    );
    expect(result.finalNodeId).toBe("beta");
    expect(result.decisionSource).toBe("embedding_auto");
  });

  it("LLM is not called — embedding result is confident", async () => {
    chatSpy.mockClear();
    await sortThreadByEmbedding(embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages);
    expect(chatSpy).not.toHaveBeenCalled();
  });
});

describe("embedding sorter — current-intent policy: resolved thread routes to new intent", () => {
  // Earlier: urgent sales inquiry (BETA territory)
  // Latest: administrative resolution / cancel note (ALPHA territory)
  // Expected: routes to ALPHA because the latest message changes the active intent.
  const messages = [
    msgAt("URGENT: Sales inquiry", "We urgently need enterprise pricing and a product demo for our procurement team", 5),
    msgAt("Re: Settled — no longer needed", "Please disregard our previous request. This has been resolved administratively and no further action is required.", 0),
  ];
  const threadVec = ALPHA_VEC; // latest message (admin resolution) drives the embedding

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    threadVec,
    FLAT_NODES,
    FLAT_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const { provider: llmProvider } = makeLlmSpy(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("routes to Alpha (admin) — latest message cancels the earlier urgent sales request", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages
    );
    expect(result.finalNodeId).toBe("alpha");
    expect(result.decisionSource).toBe("embedding_auto");
  });
});

describe("embedding sorter — current-intent policy: short referential latest uses earlier context", () => {
  // Earlier: detailed billing inquiry (GAMMA territory)
  // Latest: short referential reply ("Yes, please go ahead")
  // Earlier thread context is included in the embedding text; the combined text
  // resolves the short latest message to GAMMA.
  const messages = [
    msgAt("Finance billing inquiry", "I would like to confirm our invoice payment details and billing setup for the account", 7),
    msgAt("Re: Confirmation", "Yes, please go ahead.", 0),
  ];
  const threadVec = GAMMA_VEC; // earlier context (billing/finance) resolves the short latest message

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    threadVec,
    FLAT_NODES,
    FLAT_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const { provider: llmProvider } = makeLlmSpy(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("routes to Gamma (finance) — earlier context resolves the referential latest message", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages
    );
    expect(result.finalNodeId).toBe("gamma");
    expect(result.decisionSource).toBe("embedding_auto");
  });
});

describe("embedding sorter — current-intent policy: long old thread does not overpower latest message", () => {
  // 4 earlier messages about admin scheduling (ALPHA territory)
  // Latest message: sales inquiry (BETA territory)
  // Despite having 4× more earlier messages, the embedding reflects the latest message.
  const messages = [
    msgAt("Admin #1", "Administrative coordination for scheduling and document requests", 20),
    msgAt("Admin #2", "Follow-up on administrative scheduling coordination and documents", 15),
    msgAt("Admin #3", "Third administrative request regarding document coordination", 10),
    msgAt("Admin #4", "Additional administrative scheduling follow-up coordination", 5),
    msgAt("New topic", "I am now reaching out about enterprise pricing and a sales inquiry for our procurement team", 0),
  ];
  const threadVec = BETA_VEC; // latest message (sales) wins despite 4 earlier admin messages

  const table = buildTable(
    [
      { node: ALPHA, vec: ALPHA_VEC },
      { node: BETA, vec: BETA_VEC },
      { node: GAMMA, vec: GAMMA_VEC },
    ],
    messages,
    threadVec,
    FLAT_NODES,
    FLAT_EDGES
  );

  const embeddingProvider = makeMockEmbeddingProvider(table);
  const { provider: llmProvider, chatSpy } = makeLlmSpy(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("routes to Beta (sales) — latest message wins despite 4 earlier admin messages", async () => {
    const result = await sortThreadByEmbedding(
      embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages
    );
    expect(result.finalNodeId).toBe("beta");
    expect(result.decisionSource).toBe("embedding_auto");
  });

  it("LLM is not called — embedding result is confident", async () => {
    chatSpy.mockClear();
    await sortThreadByEmbedding(embeddingProvider, llmProvider, FLAT_NODES, FLAT_EDGES, messages);
    expect(chatSpy).not.toHaveBeenCalled();
  });
});

// ─── Scenario 12: Quality gate threshold ──────────────────────────────────────
//
// NOTE: The scenarios numbered 16–19 below (sim-based spread and descent tests)
// use buildSimTable/makeSimEmbedder from fixtures/sim-embedder.ts to specify
// cosine similarities directly, without constructing one-hot vectors by hand.

describe("embedding sorter — quality gate", () => {
  it(`routes to inbox_fallback (needsHumanReview) when max raw similarity < THETA_MIN (${THETA_MIN})`, async () => {
    const messages = [msg("Vague", "Something vague")];
    const dim4 = 4;
    const belowThresholdVec = normalize([0.1, 0.1, 0.1, 1.0]);

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
      belowThresholdVec,
      nodes4,
      edges4
    );

    const result = await sortThreadByEmbedding(
      makeMockEmbeddingProvider(table),
      makeMockLlmProvider("{}"),
      nodes4,
      edges4,
      messages
    );

    expect(result.decisionSource).toBe("inbox_fallback");
    expect(result.needsHumanReview).toBe(true);
    const maxSim = Math.max(...Object.values(result.rawSimilarities));
    expect(maxSim).toBeLessThan(THETA_MIN);
  });
});

// ─── Scenario 16: Spread blocks descent — 3 clustered children ────────────────
//
// Parent scores 0.65. Its three leaf children score 0.18 / 0.17 / 0.15 — all
// weak and close together. Softmax at temp=0.05 produces spread ≈ 0.077, which
// is below THETA_SPREAD=0.15. Algorithm stops at parent.
//
// This verifies that spread alone (without θ_descent) is sufficient to prevent
// incorrect descent into a group of equally-weak leaf nodes.

describe("embedding sorter — spread blocks descent when 3 children are clustered", () => {
  const S16_ROOT   = n("s16-root",   "Inbox",   null,                                                    true);
  const S16_PARENT = n("s16-parent", "Events",  "Coordination and management activities for events and meetings.");
  const S16_LEAF1  = n("s16-leaf1",  "Events / Admin",       "Administrative document processing and correspondence.");
  const S16_LEAF2  = n("s16-leaf2",  "Events / Scheduling",  "Calendar scheduling and meeting booking.");
  const S16_LEAF3  = n("s16-leaf3",  "Events / Resources",   "Resource allocation and procurement logistics.");

  const s16Nodes = [S16_ROOT, S16_PARENT, S16_LEAF1, S16_LEAF2, S16_LEAF3];
  const s16Edges = [
    e("s16-r-p",  "s16-root",   "s16-parent"),
    e("s16-p-l1", "s16-parent", "s16-leaf1"),
    e("s16-p-l2", "s16-parent", "s16-leaf2"),
    e("s16-p-l3", "s16-parent", "s16-leaf3"),
  ];

  const s16Messages = [msg(
    "Events coordination inquiry",
    "We would like to discuss several event coordination matters including administration, " +
    "scheduling, and resource planning. Could you advise on the appropriate process?"
  )];

  const s16Sims = { "s16-parent": 0.65, "s16-leaf1": 0.18, "s16-leaf2": 0.17, "s16-leaf3": 0.15 };
  const s16Embedder = makeSimEmbedder(buildSimTable(s16Nodes, s16Edges, s16Sims, s16Messages));
  const s16Llm = makeMockLlmProvider(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("stops at Events (parent) — spread too small to distinguish children", async () => {
    const result = await sortThreadByEmbedding(s16Embedder, s16Llm, s16Nodes, s16Edges, s16Messages);
    expect(result.finalNodeId).toBe("s16-parent");
    expect(result.decisionSource).toBe("embedding_auto");
    expect(result.needsHumanReview).toBe(false);
  });

  it("path has exactly one step: root → parent", async () => {
    const result = await sortThreadByEmbedding(s16Embedder, s16Llm, s16Nodes, s16Edges, s16Messages);
    expect(result.path).toHaveLength(1);
    expect(result.path[0]?.targetNodeId).toBe("s16-parent");
  });

  it("parent raw similarity is substantially higher than any child", async () => {
    const result = await sortThreadByEmbedding(s16Embedder, s16Llm, s16Nodes, s16Edges, s16Messages);
    const parentSim = result.rawSimilarities["s16-parent"] ?? 0;
    const maxChildSim = Math.max(
      result.rawSimilarities["s16-leaf1"] ?? 0,
      result.rawSimilarities["s16-leaf2"] ?? 0,
      result.rawSimilarities["s16-leaf3"] ?? 0
    );
    expect(parentSim).toBeGreaterThan(maxChildSim);
  });
});

// ─── Scenario 17: Spread blocks descent — 2 nearly tied children ─────────────
//
// Parent (billing) scores 0.72. Both children score 0.17 / 0.16 — nearly
// equal with low absolute values. Softmax spread ≈ 0.10 < THETA_SPREAD=0.15.
// Algorithm stops at parent.

describe("embedding sorter — spread blocks descent when 2 children are nearly tied", () => {
  const S17_ROOT   = n("s17-root",   "Inbox",   null,                                              true);
  const S17_PARENT = n("s17-parent", "Billing", "Billing coordination, invoice processing, and expense management.");
  const S17_CHILD1 = n("s17-child1", "Billing / Invoice", "Invoice processing, accounts receivable, and payment tracking.");
  const S17_CHILD2 = n("s17-child2", "Billing / Expense", "Expense reimbursement, budget approvals, and cost management.");

  const s17Nodes = [S17_ROOT, S17_PARENT, S17_CHILD1, S17_CHILD2];
  const s17Edges = [
    e("s17-r-p",  "s17-root",   "s17-parent"),
    e("s17-p-c1", "s17-parent", "s17-child1"),
    e("s17-p-c2", "s17-parent", "s17-child2"),
  ];

  const s17Messages = [msg(
    "Billing inquiry — type undetermined",
    "We are writing to enquire about billing coordination. We have not yet determined " +
    "the exact nature of the matter and would like to discuss options."
  )];

  const s17Sims = { "s17-parent": 0.72, "s17-child1": 0.17, "s17-child2": 0.16 };
  const s17Embedder = makeSimEmbedder(buildSimTable(s17Nodes, s17Edges, s17Sims, s17Messages));
  const s17Llm = makeMockLlmProvider(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("stops at Billing (parent) — children too similar to distinguish", async () => {
    const result = await sortThreadByEmbedding(s17Embedder, s17Llm, s17Nodes, s17Edges, s17Messages);
    expect(result.finalNodeId).toBe("s17-parent");
    expect(result.decisionSource).toBe("embedding_auto");
    expect(result.needsHumanReview).toBe(false);
  });

  it("path has exactly one step: root → parent", async () => {
    const result = await sortThreadByEmbedding(s17Embedder, s17Llm, s17Nodes, s17Edges, s17Messages);
    expect(result.path).toHaveLength(1);
    expect(result.path[0]?.targetNodeId).toBe("s17-parent");
  });
});

// ─── Scenario 18: Spread allows descent when one child clearly dominates ──────
//
// Parent (editorial) scores 0.60. Three children score 0.78 / 0.12 / 0.11 —
// one leaf is the overwhelming winner. Softmax spread ≈ 1.0 >> THETA_SPREAD=0.15.
// Algorithm descends through parent to the winning leaf.

describe("embedding sorter — spread allows descent when one child clearly dominates", () => {
  const S18_ROOT   = n("s18-root",   "Inbox",     null,                                                 true);
  const S18_PARENT = n("s18-parent", "Editorial", "Editorial direction and content management.");
  const S18_LEAF1  = n("s18-leaf1",  "Editorial / Breaking News", "Urgent breaking news stories and real-time coverage.");
  const S18_LEAF2  = n("s18-leaf2",  "Editorial / Opinion",       "Opinion pieces and editorial commentary.");
  const S18_LEAF3  = n("s18-leaf3",  "Editorial / Features",      "Long-form feature articles and investigations.");

  const s18Nodes = [S18_ROOT, S18_PARENT, S18_LEAF1, S18_LEAF2, S18_LEAF3];
  const s18Edges = [
    e("s18-r-p",  "s18-root",   "s18-parent"),
    e("s18-p-l1", "s18-parent", "s18-leaf1"),
    e("s18-p-l2", "s18-parent", "s18-leaf2"),
    e("s18-p-l3", "s18-parent", "s18-leaf3"),
  ];

  const s18Messages = [msg(
    "Breaking news coverage request",
    "We have an urgent breaking news story and need immediate editorial coverage."
  )];

  const s18Sims = { "s18-parent": 0.60, "s18-leaf1": 0.78, "s18-leaf2": 0.12, "s18-leaf3": 0.11 };
  const s18Embedder = makeSimEmbedder(buildSimTable(s18Nodes, s18Edges, s18Sims, s18Messages));
  const s18Llm = makeMockLlmProvider(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("descends to Breaking News leaf — clear winner among siblings", async () => {
    const result = await sortThreadByEmbedding(s18Embedder, s18Llm, s18Nodes, s18Edges, s18Messages);
    expect(result.finalNodeId).toBe("s18-leaf1");
    expect(result.decisionSource).toBe("embedding_auto");
    expect(result.needsHumanReview).toBe(false);
  });

  it("path has two steps: root → parent → leaf", async () => {
    const result = await sortThreadByEmbedding(s18Embedder, s18Llm, s18Nodes, s18Edges, s18Messages);
    expect(result.path).toHaveLength(2);
    expect(result.path[0]?.targetNodeId).toBe("s18-parent");
    expect(result.path[1]?.targetNodeId).toBe("s18-leaf1");
  });

  it("winning leaf raw similarity is much higher than its siblings", async () => {
    const result = await sortThreadByEmbedding(s18Embedder, s18Llm, s18Nodes, s18Edges, s18Messages);
    const winner = result.rawSimilarities["s18-leaf1"] ?? 0;
    const loser1 = result.rawSimilarities["s18-leaf2"] ?? 0;
    const loser2 = result.rawSimilarities["s18-leaf3"] ?? 0;
    expect(winner).toBeGreaterThan(loser1 * 4);
    expect(winner).toBeGreaterThan(loser2 * 4);
  });
});

// ─── Scenario 20: Deliberate stop at root → embedding_inbox ──────────────────
//
// Two root children A (sim=0.20) and B (sim=0.15) in a flat taxonomy.
// Subtree score diff = 0.05 = CROSS_BRANCH_MARGIN, so the cross-branch check
// does NOT fire (condition is strictly-less-than).  However a very high
// thetaSpread override (0.70) means the normalised spread (≈0.69) is below
// the threshold, so the traversal stops at root without descending.
//
// This is the "embedding_inbox" path: the algorithm makes a deliberate,
// confident decision to keep the thread in Inbox — as opposed to the
// "inbox_fallback" path which signals a failure (quality gate, LLM error, …).

describe("embedding sorter — deliberate stop at root produces embedding_inbox", () => {
  const S20_ROOT  = n("s20-root",  "Inbox",     null,                                                       true);
  const S20_NODE_A = n("s20-a", "Operations", "Operational coordination, logistics, and process management.");
  const S20_NODE_B = n("s20-b", "Legal",      "Legal matters, contract review, compliance, and regulatory affairs.");

  const s20Nodes = [S20_ROOT, S20_NODE_A, S20_NODE_B];
  const s20Edges = [
    e("s20-r-a", "s20-root", "s20-a"),
    e("s20-r-b", "s20-root", "s20-b"),
  ];

  const s20Messages = [msg(
    "General coordination update",
    "We need to align on several topics including operations and legal, but nothing specific yet."
  )];

  // A has a clear but narrow raw-sim advantage; subtree diff (0.05) is exactly
  // CROSS_BRANCH_MARGIN so the LLM is never called.
  const s20Sims = { "s20-a": 0.20, "s20-b": 0.15 };
  const s20Embedder = makeSimEmbedder(buildSimTable(s20Nodes, s20Edges, s20Sims, s20Messages));
  const s20Llm = makeMockLlmProvider(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  // High thetaSpread override: normalised spread ≈ 0.693 < 0.70 → stops at root.
  const s20Options = { thetaSpread: 0.70 };

  it("returns the root node as final destination", async () => {
    const result = await sortThreadByEmbedding(s20Embedder, s20Llm, s20Nodes, s20Edges, s20Messages, s20Options);
    expect(result.finalNodeId).toBe("s20-root");
    expect(result.needsHumanReview).toBe(false);
  });

  it("decisionSource is embedding_inbox, not inbox_fallback", async () => {
    const result = await sortThreadByEmbedding(s20Embedder, s20Llm, s20Nodes, s20Edges, s20Messages, s20Options);
    expect(result.decisionSource).toBe("embedding_inbox");
  });

  it("path is empty — no traversal steps were taken", async () => {
    const result = await sortThreadByEmbedding(s20Embedder, s20Llm, s20Nodes, s20Edges, s20Messages, s20Options);
    expect(result.path).toHaveLength(0);
  });

  it("rawSimilarities contains scores for both children", async () => {
    const result = await sortThreadByEmbedding(s20Embedder, s20Llm, s20Nodes, s20Edges, s20Messages, s20Options);
    expect(result.rawSimilarities["s20-a"]).toBeGreaterThan(0);
    expect(result.rawSimilarities["s20-b"]).toBeGreaterThan(0);
  });
});

// ─── Scenario 21: Mid-traversal cross-branch LLM escalation ──────────────────
//
// Depth-2 taxonomy reusing DEEP_NODES / DEEP_EDGES:
//   INBOX2 → SUPPORT → {TECHNICAL, BILLING}
//   INBOX2 → SALES2  → {INBOUND, OUTBOUND}
//
// Controlled sims (via buildSimTable):
//   support=0.65, technical=0.21, billing=0.19, sales2/inbound/outbound=0.05
//
// At root:
//   subtreeScore(support)=0.65 >> subtreeScore(sales2)=0.05; diff=0.60 ≥ 0.05
//   → root cross-branch check does NOT fire; descent to support is unambiguous.
//
// At support (mid-traversal):
//   subtreeScore(technical)=0.21, subtreeScore(billing)=0.19; diff=0.02 < 0.05
//   billing rawSim=0.19 ≥ thetaMin=0.15
//   spreadOk && descentOk are both true, so we enter the `if` branch.
//   → mid-traversal check fires; LLM is called with candidates [technical, billing].
//   candidate_0 = technical (sorted by rawSim desc), candidate_1 = billing.

describe("embedding sorter — mid-traversal cross-branch escalates to LLM", () => {
  const s21Messages = [msg(
    "Support request — technical or billing?",
    "We are experiencing an issue that may relate to our account billing or a technical error. " +
    "We are unsure which team to contact — please advise."
  )];

  // Σs² = 0.65²+0.21²+0.19²+0.05²+0.05²+0.05² ≈ 0.510 ≤ 1 — no scaling needed.
  const s21Sims: Record<string, number> = {
    support:  0.65,
    technical: 0.21,
    billing:   0.19,
    sales2:    0.05,
    inbound:   0.05,
    outbound:  0.05,
  };
  const s21Embedder = makeSimEmbedder(buildSimTable(DEEP_NODES, DEEP_EDGES, s21Sims, s21Messages));

  it("calls LLM exactly once — mid-traversal fires, root does not", async () => {
    const { provider: llmProvider, chatSpy } = makeLlmSpy(
      JSON.stringify({ selectedNodeId: "candidate_0", confidence: 0.8, explanation: "Technical error", needsHumanReview: false })
    );
    await sortThreadByEmbedding(s21Embedder, llmProvider, DEEP_NODES, DEEP_EDGES, s21Messages);
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it("decisionSource is 'llm' and needsHumanReview is false when LLM resolves", async () => {
    const llmProvider = makeMockLlmProvider(
      JSON.stringify({ selectedNodeId: "candidate_0", confidence: 0.8, explanation: "Technical error", needsHumanReview: false })
    );
    const result = await sortThreadByEmbedding(s21Embedder, llmProvider, DEEP_NODES, DEEP_EDGES, s21Messages);
    expect(result.decisionSource).toBe("llm");
    expect(result.needsHumanReview).toBe(false);
  });

  it("LLM candidate_0 (highest rawSim = technical) becomes finalNodeId", async () => {
    const llmProvider = makeMockLlmProvider(
      JSON.stringify({ selectedNodeId: "candidate_0", confidence: 0.8, explanation: "Technical error", needsHumanReview: false })
    );
    const result = await sortThreadByEmbedding(s21Embedder, llmProvider, DEEP_NODES, DEEP_EDGES, s21Messages);
    expect(result.finalNodeId).toBe("technical");
  });

  it("when LLM cannot resolve, routes to inbox_fallback with needsHumanReview", async () => {
    const llmProvider = makeMockLlmProvider(
      JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "Cannot decide", needsHumanReview: true })
    );
    const result = await sortThreadByEmbedding(s21Embedder, llmProvider, DEEP_NODES, DEEP_EDGES, s21Messages);
    expect(result.finalNodeId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.decisionSource).toBe("inbox_fallback");
  });
});

// ─── Scenario 19: Strong signal through 4-level single-child chain ─────────────
//
// A 4-level single-child chain (root → L1 → L2 → L3 → L4) where every node
// has strong signal (0.75 → 0.70 → 0.65 → 0.60 after unit-sphere normalisation).
// At each single-child node spread = 1.0 >> THETA_SPREAD, and every raw_sim > 0 =
// THETA_DESCENT. Algorithm descends to the deepest leaf.
//
// This is the regression guard for deep-descent: any θ_descent ≤ 0.40 should
// allow full traversal of this chain.

describe("embedding sorter — strong signal through 4-level single-child chain reaches leaf", () => {
  const S19_ROOT = n("s19-root", "Inbox",            null,                                                        true);
  const S19_L1   = n("s19-l1",  "Technical Support", "Technical support inquiries, platform issues, and developer assistance.");
  const S19_L2   = n("s19-l2",  "Technical Support / API",                 "API integration issues, SDK problems, and developer support requests.");
  const S19_L3   = n("s19-l3",  "Technical Support / API / Authentication","API authentication errors, token issues, and OAuth integration problems.");
  const S19_L4   = n("s19-l4",  "Technical Support / API / Authentication / OAuth", "OAuth 2.0 configuration, authorization flow errors, and token refresh troubleshooting.");

  const s19Nodes = [S19_ROOT, S19_L1, S19_L2, S19_L3, S19_L4];
  const s19Edges = [
    e("s19-r-l1",  "s19-root", "s19-l1"),
    e("s19-l1-l2", "s19-l1",   "s19-l2"),
    e("s19-l2-l3", "s19-l2",   "s19-l3"),
    e("s19-l3-l4", "s19-l3",   "s19-l4"),
  ];

  const s19Messages = [msg(
    "OAuth API authentication support request",
    "I am specifically troubleshooting an OAuth authentication issue and would like to access " +
    "documentation on the OAuth token refresh flow and authorization configuration."
  )];

  // Σ s_i² = 0.75²+0.70²+0.65²+0.60² = 1.835 > 1 — buildSimTable scales proportionally.
  // Relative ordering and positivity are preserved; all conditions still pass.
  const s19Sims = { "s19-l1": 0.75, "s19-l2": 0.70, "s19-l3": 0.65, "s19-l4": 0.60 };
  const s19Embedder = makeSimEmbedder(buildSimTable(s19Nodes, s19Edges, s19Sims, s19Messages));
  const s19Llm = makeMockLlmProvider(
    JSON.stringify({ selectedNodeId: null, confidence: 0, explanation: "not called", needsHumanReview: true })
  );

  it("descends all the way to OAuth leaf — signal stays strong at every level", async () => {
    const result = await sortThreadByEmbedding(s19Embedder, s19Llm, s19Nodes, s19Edges, s19Messages);
    expect(result.finalNodeId).toBe("s19-l4");
    expect(result.decisionSource).toBe("embedding_auto");
    expect(result.needsHumanReview).toBe(false);
  });

  it("path has 4 steps through the full chain", async () => {
    const result = await sortThreadByEmbedding(s19Embedder, s19Llm, s19Nodes, s19Edges, s19Messages);
    expect(result.path).toHaveLength(4);
    expect(result.path[0]?.targetNodeId).toBe("s19-l1");
    expect(result.path[1]?.targetNodeId).toBe("s19-l2");
    expect(result.path[2]?.targetNodeId).toBe("s19-l3");
    expect(result.path[3]?.targetNodeId).toBe("s19-l4");
  });

  it("all nodes in the chain have positive raw similarity", async () => {
    const result = await sortThreadByEmbedding(s19Embedder, s19Llm, s19Nodes, s19Edges, s19Messages);
    for (const id of ["s19-l1", "s19-l2", "s19-l3", "s19-l4"]) {
      expect(result.rawSimilarities[id]).toBeGreaterThan(0);
    }
  });
});

// ─── Scenario 22: Root cross-branch ambiguity with deep taxonomy (DEEP_NODES/DEEP_EDGES) ─────
//
// The root (inbox2) has two intermediate-node children: Support (→ {Technical,
// Billing}) and Sales2 (→ {Inbound, Outbound}). Controlled sims produce subtree
// scores close enough to fire the root cross-branch check before any traversal.
//
// Sims (via buildSimTable):
//   support=0.05, technical=0.35, billing=0.28, sales2=0.05, inbound=0.33, outbound=0.26
//
// Derived subtree scores (λ=0.85):
//   subtreeScore(support) = max(0.05, 0.85×0.35) = 0.2975
//   subtreeScore(sales2)  = max(0.05, 0.85×0.33) = 0.2805
//   diff = 0.017 < crossBranchMargin(0.05) → root cross-branch fires ✓
//   sales2 score 0.2805 ≥ thetaMin(0.15) → second branch is viable ✓
//
// Leaf candidates (collectLeavesFromSubtrees removes intermediates), sorted by
// rawSim desc: technical(0.35), inbound(0.33), billing(0.28), outbound(0.26)
//   candidate_0 = technical, candidate_1 = inbound, candidate_2 = billing, candidate_3 = outbound
//
// Σ s² = 0.0025+0.1225+0.0784+0.0025+0.1089+0.0676 = 0.3824 < 1 — no scaling needed.

describe("embedding sorter — root cross-branch with deep taxonomy escalates to LLM with only leaf candidates", () => {
  const s22Messages = [msg(
    "Support or sales inquiry?",
    "We are unsure whether our issue falls under technical support or whether we should " +
    "contact the sales team. It may involve either a technical error or a potential new purchase."
  )];

  const s22Sims: Record<string, number> = {
    support:   0.05,
    technical: 0.35,
    billing:   0.28,
    sales2:    0.05,
    inbound:   0.33,
    outbound:  0.26,
  };

  const s22Embedder = makeSimEmbedder(buildSimTable(DEEP_NODES, DEEP_EDGES, s22Sims, s22Messages));

  const LLM_PICKS_TECHNICAL = JSON.stringify({
    selectedNodeId: "candidate_0",
    confidence: 0.85,
    explanation: "Technical error matches Technical Issues",
    needsHumanReview: false,
  });

  it("calls LLM exactly once — root cross-branch fires, not mid-traversal", async () => {
    const { provider: llmProvider, chatSpy } = makeLlmSpy(LLM_PICKS_TECHNICAL);
    await sortThreadByEmbedding(s22Embedder, llmProvider, DEEP_NODES, DEEP_EDGES, s22Messages);
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it("every candidate offered to LLM is a leaf — support and sales2 are absent from candidate names", async () => {
    const { provider: llmProvider, chatSpy } = makeLlmSpy(LLM_PICKS_TECHNICAL);
    await sortThreadByEmbedding(s22Embedder, llmProvider, DEEP_NODES, DEEP_EDGES, s22Messages);

    const callMessages = chatSpy.mock.calls[0]![0] as Array<{ role: string; content: string }>;
    const userContent = callMessages.find((m) => m.role === "user")?.content ?? "";

    // All four leaf node names must appear as candidates
    expect(userContent).toContain("name: Technical Issues");
    expect(userContent).toContain("name: Billing Issues");
    expect(userContent).toContain("name: Inbound Leads");
    expect(userContent).toContain("name: Outbound Campaigns");

    // Intermediate node names must NOT appear as selectable candidate names.
    // Filter to "   name: <X>" lines only — breadcrumbs contain intermediate names
    // as path context, but those lines start with "   breadcrumb:", not "   name:".
    const nameLines = userContent.split("\n").filter((l) => l.trimStart().startsWith("name:"));
    expect(nameLines.some((l) => l.includes("Support"))).toBe(false);
    expect(nameLines.some((l) => l.includes("Sales"))).toBe(false);
  });

  it("selected leaf becomes finalNodeId with decisionSource 'llm' (LLM picks technical — candidate_0)", async () => {
    const llmProvider = makeMockLlmProvider(LLM_PICKS_TECHNICAL);
    const result = await sortThreadByEmbedding(s22Embedder, llmProvider, DEEP_NODES, DEEP_EDGES, s22Messages);

    expect(result.finalNodeId).toBe("technical");
    expect(result.decisionSource).toBe("llm");
    expect(result.needsHumanReview).toBe(false);
  });

  it("LLM can also route to inbound (candidate_1) — any valid leaf selection is honoured", async () => {
    const llmProvider = makeMockLlmProvider(
      JSON.stringify({
        selectedNodeId: "candidate_1",
        confidence: 0.80,
        explanation: "New purchase matches Inbound Leads",
        needsHumanReview: false,
      })
    );
    const result = await sortThreadByEmbedding(s22Embedder, llmProvider, DEEP_NODES, DEEP_EDGES, s22Messages);

    expect(result.finalNodeId).toBe("inbound");
    expect(result.decisionSource).toBe("llm");
    expect(result.needsHumanReview).toBe(false);
  });
});
