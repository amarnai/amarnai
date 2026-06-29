import { describe, it, expect } from "vitest";
import { sortThreadByEmbedding } from "../embedding/sorter.js";
import {
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  deriveBreadcrumb,
} from "../embedding/math.js";
import { createDeferredLlmContext, DeferLlmSignal } from "../batch/deferred-llm.js";
import { MockBatchProvider } from "../providers/batch-mock.js";
import type { EmbeddingProvider } from "../embedding/types.js";
import type { AIProvider, TaxonomyNodeInput, TaxonomyEdgeInput, ThreadMessage } from "../types.js";

// ─── Minimal cross-branch fixture (mirrors the sorter test's FLAT setup) ─────────

function n(id: string, name: string, description: string | null, isRoot = false): TaxonomyNodeInput {
  return { id, name, description, instructions: null, examples: [], isRoot };
}
function e(id: string, sourceNodeId: string, targetNodeId: string): TaxonomyEdgeInput {
  return { id, sourceNodeId, targetNodeId };
}
function oneHot(index: number, dim: number): number[] {
  return Array.from({ length: dim }, (_, i) => (i === index ? 1 : 0));
}
function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

const INBOX = n("inbox", "Inbox", null, true);
const ALPHA = n("alpha", "Alpha", "Administrative coordination and scheduling requests");
const BETA = n("beta", "Beta", "Sales inquiries, business development, and inbound lead qualification");
const GAMMA = n("gamma", "Gamma", "Finance requests, billing inquiries, and payment processing");
const NODES = [INBOX, ALPHA, BETA, GAMMA];
const EDGES = [e("e1", "inbox", "alpha"), e("e2", "inbox", "beta"), e("e3", "inbox", "gamma")];

const VECS: Record<string, number[]> = { alpha: oneHot(0, 3), beta: oneHot(1, 3), gamma: oneHot(2, 3) };
// Halfway between alpha and beta → forces a root cross-branch escalation.
const THREAD_VEC = normalize([1, 1, 0]);
const MESSAGES: ThreadMessage[] = [
  { subject: "Ambiguous request", senderEmail: "a@b.com", senderName: null, bodyText: "Scheduling a media appearance", receivedAt: new Date() },
];

function makeEmbeddingProvider(): EmbeddingProvider {
  const table = new Map<string, number[]>();
  for (const node of [ALPHA, BETA, GAMMA]) {
    const breadcrumb = deriveBreadcrumb(node.id, NODES, EDGES);
    table.set(buildNodeEmbeddingText({ name: node.name, description: node.description!, breadcrumb }), VECS[node.id]!);
  }
  const threadText = buildThreadEmbeddingText(MESSAGES.map((m) => ({ subject: m.subject, bodyText: m.bodyText })));
  table.set(threadText, THREAD_VEC);
  return {
    providerName: "mock",
    modelName: "mock-v1",
    async embed(texts) {
      return texts.map((t) => table.get(t) ?? new Array(3).fill(0));
    },
  };
}

const LLM_ANSWER = JSON.stringify({
  selectedNodeId: "candidate_1",
  confidence: 0.9,
  explanation: "Media appearance matches Beta",
  needsHumanReview: false,
});

function inlineLlm(answer: string): AIProvider {
  return { providerName: "mock", modelName: "mock-llm", async chat() { return answer; } };
}

// ─── createDeferredLlmContext ────────────────────────────────────────────────────

describe("createDeferredLlmContext", () => {
  it("records the request and throws DeferLlmSignal on a cache miss", async () => {
    const ctx = createDeferredLlmContext(new Map());
    await expect(
      ctx.llmMemoizer("llm-ambiguity:root:abc", () => ctx.llmProvider.chat([{ role: "system", content: "S" }, { role: "user", content: "U" }])),
    ).rejects.toBeInstanceOf(DeferLlmSignal);
    expect(ctx.pending).toHaveLength(1);
    expect(ctx.pending[0]).toMatchObject({ step: "llm-ambiguity:root:abc", system: "S", user: "U" });
  });

  it("replays a stored answer without calling the provider", async () => {
    const ctx = createDeferredLlmContext(new Map([["step-1", "stored-answer"]]));
    const out = await ctx.llmMemoizer("step-1", async () => "should-not-run");
    expect(out).toBe("stored-answer");
    expect(ctx.pending).toHaveLength(0);
  });
});

// ─── Deferred routing equivalence ────────────────────────────────────────────────

describe("deferred routing equals inline routing", () => {
  it("defers the escalation, then replays the answer to the same final node", async () => {
    const embeddingProvider = makeEmbeddingProvider();

    // Inline reference.
    const inline = await sortThreadByEmbedding(embeddingProvider, inlineLlm(LLM_ANSWER), NODES, EDGES, MESSAGES, {
      precomputedThreadVector: THREAD_VEC,
    });
    expect(inline.decisionSource).toBe("llm");
    expect(inline.finalNodeId).toBe("beta");

    // Round 1: deferred, no answers → escalation is recorded + thrown.
    const ctx1 = createDeferredLlmContext(new Map());
    let pending: typeof ctx1.pending = [];
    await expect(
      sortThreadByEmbedding(embeddingProvider, ctx1.llmProvider, NODES, EDGES, MESSAGES, {
        precomputedThreadVector: THREAD_VEC,
        llmMemoizer: ctx1.llmMemoizer,
      }).catch((err) => {
        if (err instanceof DeferLlmSignal) { pending = ctx1.pending; return; }
        throw err;
      }),
    ).resolves.toBeUndefined();
    expect(pending).toHaveLength(1);
    const step = pending[0]!.step;

    // Round 2: replay the batched answer keyed by the recorded step.
    const ctx2 = createDeferredLlmContext(new Map([[step, LLM_ANSWER]]));
    const replayed = await sortThreadByEmbedding(embeddingProvider, ctx2.llmProvider, NODES, EDGES, MESSAGES, {
      precomputedThreadVector: THREAD_VEC,
      llmMemoizer: ctx2.llmMemoizer,
    });
    expect(replayed.decisionSource).toBe(inline.decisionSource);
    expect(replayed.finalNodeId).toBe(inline.finalNodeId);
  });
});

// ─── MockBatchProvider ───────────────────────────────────────────────────────────

describe("MockBatchProvider", () => {
  it("maps embedding results back by key, deterministically", async () => {
    const p = new MockBatchProvider({ dim: 4 });
    const { providerJobId } = await p.submitEmbeddings([
      { key: "ws|t1", text: "hello" },
      { key: "ws|t2", text: "world" },
    ]);
    expect(await p.poll(providerJobId)).toBe("COMPLETED");
    const { items } = await p.fetchEmbeddingResults(providerJobId);
    const byKey = new Map(items.map((i) => [i.key, i.vector]));
    expect(byKey.get("ws|t1")).toHaveLength(4);
    // Same text → same vector (deterministic).
    const again = new MockBatchProvider({ dim: 4 });
    const r2 = await again.submitEmbeddings([{ key: "x|y", text: "hello" }]);
    const { items: items2 } = await again.fetchEmbeddingResults(r2.providerJobId);
    expect(items2[0]!.vector).toEqual(byKey.get("ws|t1"));
  });

  it("returns generate answers keyed per request and reports token usage", async () => {
    const p = new MockBatchProvider();
    const { providerJobId } = await p.submitGenerate([
      { key: "ws|t1|step-a", system: "S", user: "U1" },
      { key: "ws|t2|step-b", system: "S", user: "U2" },
    ]);
    const { items, inputTokens, outputTokens } = await p.fetchGenerateResults(providerJobId);
    expect(items.map((i) => i.key).sort()).toEqual(["ws|t1|step-a", "ws|t2|step-b"]);
    for (const i of items) expect(i.output).toContain("candidate_0");
    expect(inputTokens).toBeGreaterThan(0);
    expect(outputTokens).toBeGreaterThan(0);
  });

  it("honors a forced non-terminal poll status", async () => {
    const p = new MockBatchProvider({ status: "RUNNING" });
    const { providerJobId } = await p.submitEmbeddings([{ key: "k", text: "t" }]);
    expect(await p.poll(providerJobId)).toBe("RUNNING");
  });
});
