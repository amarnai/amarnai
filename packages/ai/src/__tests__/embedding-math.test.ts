import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  softmax,
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
  computeSubtreeScores,
  deriveBreadcrumb,
  findDescendants,
  getStaleEmbeddableNodes,
} from "../embedding/math.js";
import type { TaxonomyEdgeInput } from "../types.js";
import type { EmbeddableNode } from "../embedding/types.js";

// ─── cosineSimilarity ─────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("identical unit vectors → 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("antiparallel unit vectors → -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("perpendicular vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("zero vector → 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([1, 0, 0], [0, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("empty vectors → 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("mismatched lengths → 0", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it("non-unit vectors have the same similarity as their normalised forms", () => {
    expect(cosineSimilarity([2, 0], [3, 0])).toBeCloseTo(1);
  });

  it("45-degree vectors → ~0.707", () => {
    const a = [1, 0];
    const b = [1, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

// ─── softmax ──────────────────────────────────────────────────────────────────

describe("softmax", () => {
  it("probabilities sum to 1", () => {
    const p = softmax([0.8, 0.3, 0.5], 0.15);
    const sum = p.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("higher score receives higher probability", () => {
    const p = softmax([0.9, 0.4, 0.2], 0.15);
    expect(p[0]).toBeGreaterThan(p[1]!);
    expect(p[1]).toBeGreaterThan(p[2]!);
  });

  it("equal scores → uniform distribution", () => {
    const p = softmax([0.5, 0.5, 0.5], 0.15);
    expect(p[0]).toBeCloseTo(1 / 3);
    expect(p[1]).toBeCloseTo(1 / 3);
    expect(p[2]).toBeCloseTo(1 / 3);
  });

  it("single score → [1.0]", () => {
    expect(softmax([0.7], 0.15)).toEqual([1]);
  });

  it("empty array → []", () => {
    expect(softmax([], 0.15)).toEqual([]);
  });

  it("lower temperature sharpens the distribution", () => {
    const hot = softmax([0.8, 0.6], 0.5);
    const cold = softmax([0.8, 0.6], 0.05);
    expect(cold[0]! - cold[1]!).toBeGreaterThan(hot[0]! - hot[1]!);
  });
});

// ─── buildNodeEmbeddingText ────────────────────────────────────────────────────

describe("buildNodeEmbeddingText", () => {
  it("output contains Path:, Name:, and Description: lines", () => {
    const text = buildNodeEmbeddingText({
      name: "Weddings",
      description: "Wedding planning.",
      breadcrumb: "Inbox > Weddings",
    });
    expect(text).toContain("Path: Inbox > Weddings");
    expect(text).toContain("Name: Weddings");
    expect(text).toContain("Description: Wedding planning.");
  });

  it("breadcrumb appears on the first line prefixed with 'Path:'", () => {
    const text = buildNodeEmbeddingText({
      name: "Funerals",
      description: "Memorial services.",
      breadcrumb: "Inbox > Events > Funerals",
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Path: Inbox > Events > Funerals");
    expect(lines[1]).toBe("Name: Funerals");
    expect(lines[2]).toBe("Description: Memorial services.");
  });

  it("all three fields are present in the output", () => {
    const text = buildNodeEmbeddingText({
      name: "Press",
      description: "Media and press relations.",
      breadcrumb: "Inbox > Press",
    });
    expect(text).toMatch(/Path:/);
    expect(text).toMatch(/Name:/);
    expect(text).toMatch(/Description:/);
  });

  it("is deterministic for identical inputs", () => {
    const node = { name: "Funerals", description: "Memorial services.", breadcrumb: "Inbox > Funerals" };
    expect(buildNodeEmbeddingText(node)).toBe(buildNodeEmbeddingText(node));
  });

  it("different breadcrumbs produce different text", () => {
    const base = { name: "Node", description: "A description." };
    const t1 = buildNodeEmbeddingText({ ...base, breadcrumb: "Inbox > Node" });
    const t2 = buildNodeEmbeddingText({ ...base, breadcrumb: "Inbox > Parent > Node" });
    expect(t1).not.toBe(t2);
  });
});

// ─── buildThreadEmbeddingText ─────────────────────────────────────────────────

describe("buildThreadEmbeddingText", () => {
  it("includes subject from first message", () => {
    const text = buildThreadEmbeddingText([
      { subject: "My Subject", bodyText: "hello" },
    ]);
    expect(text).toContain("Subject: My Subject");
  });

  it("includes body excerpts", () => {
    const text = buildThreadEmbeddingText([
      { subject: "S", bodyText: "body text here" },
    ]);
    expect(text).toContain("body text here");
  });

  it("truncates body at 500 chars", () => {
    const long = "x".repeat(1000);
    const text = buildThreadEmbeddingText([{ subject: null, bodyText: long }]);
    expect(text.length).toBeLessThan(600);
  });

  it("handles empty message list", () => {
    expect(buildThreadEmbeddingText([])).toBe("");
  });

  it("handles null subject and body", () => {
    const text = buildThreadEmbeddingText([{ subject: null, bodyText: null }]);
    expect(text).toBe("");
  });

  it("single-message thread: no labels added (backward-compatible format)", () => {
    const text = buildThreadEmbeddingText([{ subject: "S", bodyText: "just one message" }]);
    expect(text).not.toContain("[LATEST MESSAGE");
    expect(text).not.toContain("[EARLIER THREAD CONTEXT");
    expect(text).toContain("just one message");
  });

  it("multi-message thread: latest message appears first with primary-signal label", () => {
    const text = buildThreadEmbeddingText([
      { subject: "Original", bodyText: "earlier content here" },
      { subject: "Re: Original", bodyText: "latest content here" },
    ]);
    expect(text).toContain("[LATEST MESSAGE — primary classification signal]");
    expect(text).toContain("latest content here");
    expect(text).toContain("[EARLIER THREAD CONTEXT — secondary]");
    expect(text).toContain("earlier content here");
    // Latest appears before earlier in the combined text
    expect(text.indexOf("latest content here")).toBeLessThan(text.indexOf("earlier content here"));
  });

  it("multi-message thread: subject always comes from the first message", () => {
    const text = buildThreadEmbeddingText([
      { subject: "Original Subject", bodyText: "older body" },
      { subject: "Re: Original Subject", bodyText: "newer body" },
    ]);
    expect(text).toContain("Subject: Original Subject");
  });

  it("multi-message thread: each body is still truncated at 500 chars", () => {
    const long = "y".repeat(1000);
    const text = buildThreadEmbeddingText([
      { subject: null, bodyText: long },
      { subject: null, bodyText: long },
    ]);
    // Labels + subject add some overhead; check that no single body block exceeds 500
    const latestLabel = "[LATEST MESSAGE — primary classification signal]";
    const earlierLabel = "[EARLIER THREAD CONTEXT — secondary]";
    const latestStart = text.indexOf(latestLabel) + latestLabel.length;
    const earlierStart = text.indexOf(earlierLabel);
    const latestBody = text.slice(latestStart, earlierStart).trim();
    expect(latestBody.length).toBeLessThanOrEqual(500);
  });
});

// ─── hashEmbeddingInput ───────────────────────────────────────────────────────

describe("hashEmbeddingInput", () => {
  it("same text and model → same hash", () => {
    expect(hashEmbeddingInput("foo", "model-a")).toBe(hashEmbeddingInput("foo", "model-a"));
  });

  it("different text → different hash", () => {
    expect(hashEmbeddingInput("foo", "model-a")).not.toBe(hashEmbeddingInput("bar", "model-a"));
  });

  it("different model → different hash", () => {
    expect(hashEmbeddingInput("foo", "model-a")).not.toBe(hashEmbeddingInput("foo", "model-b"));
  });

  it("produces a 64-char hex string (SHA-256)", () => {
    const h = hashEmbeddingInput("text", "model");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("old format (name\\ndescription) produces a different hash than new format", () => {
    const name = "Weddings";
    const description = "Wedding ceremony requests.";
    const oldText = `${name}\n${description}`;
    const newText = buildNodeEmbeddingText({
      name,
      description,
      breadcrumb: "Inbox > Weddings",
    });
    expect(hashEmbeddingInput(oldText, "model-v1")).not.toBe(
      hashEmbeddingInput(newText, "model-v1")
    );
  });
});

// ─── deriveBreadcrumb ─────────────────────────────────────────────────────────

describe("deriveBreadcrumb", () => {
  const INBOX = { id: "inbox", name: "Inbox", isRoot: true };
  const EVENTS = { id: "events", name: "Events", isRoot: false };
  const WEDDINGS = { id: "weddings", name: "Weddings", isRoot: false };

  const nodes = [INBOX, EVENTS, WEDDINGS];
  const edges: TaxonomyEdgeInput[] = [
    { id: "e1", sourceNodeId: "inbox", targetNodeId: "events" },
    { id: "e2", sourceNodeId: "events", targetNodeId: "weddings" },
  ];

  it("root node returns just its own name", () => {
    expect(deriveBreadcrumb("inbox", nodes, edges)).toBe("Inbox");
  });

  it("direct child of root returns 'Root > Child'", () => {
    expect(deriveBreadcrumb("events", nodes, edges)).toBe("Inbox > Events");
  });

  it("grandchild returns full three-level path", () => {
    expect(deriveBreadcrumb("weddings", nodes, edges)).toBe("Inbox > Events > Weddings");
  });

  it("node absent from all edges returns just its own name", () => {
    const orphan = { id: "orphan", name: "Orphan", isRoot: false };
    expect(deriveBreadcrumb("orphan", [...nodes, orphan], edges)).toBe("Orphan");
  });

  it("node not in node list returns empty string (unknown node)", () => {
    expect(deriveBreadcrumb("ghost", nodes, edges)).toBe("");
  });

  it("does not infinite-loop on a cycle", () => {
    const cycleEdges: TaxonomyEdgeInput[] = [
      { id: "c1", sourceNodeId: "a", targetNodeId: "b" },
      { id: "c2", sourceNodeId: "b", targetNodeId: "a" }, // cycle
    ];
    const cycleNodes = [
      { id: "a", name: "A", isRoot: false },
      { id: "b", name: "B", isRoot: false },
    ];
    // Should return something without hanging
    const result = deriveBreadcrumb("b", cycleNodes, cycleEdges);
    expect(typeof result).toBe("string");
  });

  it("is deterministic for identical inputs", () => {
    expect(deriveBreadcrumb("weddings", nodes, edges)).toBe(
      deriveBreadcrumb("weddings", nodes, edges)
    );
  });
});

// ─── findDescendants ──────────────────────────────────────────────────────────

describe("findDescendants", () => {
  //   root → A → A1
  //               └─ A2
  //        → B
  const edges: TaxonomyEdgeInput[] = [
    { id: "e-r-a", sourceNodeId: "root", targetNodeId: "A" },
    { id: "e-r-b", sourceNodeId: "root", targetNodeId: "B" },
    { id: "e-a-a1", sourceNodeId: "A", targetNodeId: "A1" },
    { id: "e-a-a2", sourceNodeId: "A", targetNodeId: "A2" },
  ];

  it("leaf node (no children) returns []", () => {
    expect(findDescendants("B", edges)).toEqual([]);
    expect(findDescendants("A1", edges)).toEqual([]);
  });

  it("node with one child returns [childId]", () => {
    expect(findDescendants("B", edges)).toEqual([]);
    // A has two children
    const desc = findDescendants("A", edges);
    expect(desc).toContain("A1");
    expect(desc).toContain("A2");
    expect(desc).toHaveLength(2);
  });

  it("root returns all four descendants", () => {
    const desc = findDescendants("root", edges);
    expect(desc).toContain("A");
    expect(desc).toContain("B");
    expect(desc).toContain("A1");
    expect(desc).toContain("A2");
    expect(desc).toHaveLength(4);
  });

  it("does not include nodeId itself", () => {
    const desc = findDescendants("root", edges);
    expect(desc).not.toContain("root");

    const descA = findDescendants("A", edges);
    expect(descA).not.toContain("A");
  });

  it("disconnected node returns []", () => {
    expect(findDescendants("ghost", edges)).toEqual([]);
  });

  it("handles empty edge list", () => {
    expect(findDescendants("any", [])).toEqual([]);
  });
});

// ─── computeSubtreeScores ─────────────────────────────────────────────────────

describe("computeSubtreeScores", () => {
  const edges: TaxonomyEdgeInput[] = [
    { id: "e-root-A", sourceNodeId: "root", targetNodeId: "A" },
    { id: "e-root-B", sourceNodeId: "root", targetNodeId: "B" },
    { id: "e-A-A1", sourceNodeId: "A", targetNodeId: "A1" },
    { id: "e-A-A2", sourceNodeId: "A", targetNodeId: "A2" },
  ];

  it("leaf node gets its raw similarity", () => {
    const rawSims = new Map([["A1", 0.8], ["A2", 0.2], ["B", 0.3], ["A", 0.1]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A1")).toBeCloseTo(0.8);
    expect(scores.get("B")).toBeCloseTo(0.3);
  });

  it("parent score = max(rawSim, decay * maxChildScore)", () => {
    const rawSims = new Map([["A1", 0.8], ["A2", 0.2], ["B", 0.3], ["A", 0.1]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A")).toBeCloseTo(0.76);
  });

  it("large subtree does not dominate: max not sum", () => {
    const rawSims = new Map([["A1", 0.8], ["A2", 0.7], ["B", 0.75], ["A", 0.0]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A")).toBeCloseTo(0.76);
    expect(scores.get("B")).toBeCloseTo(0.75);
    expect(scores.get("A")! - scores.get("B")!).toBeLessThan(0.1);
  });

  it("root node has no rawSim but gets score via children", () => {
    const rawSims = new Map([["A1", 0.8], ["A2", 0.2], ["B", 0.3], ["A", 0.1]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("root")).toBeCloseTo(0.722);
  });

  it("decay factor propagates correctly across multiple levels", () => {
    const rawSims = new Map([["A1", 1.0], ["A2", 0.0], ["B", 0.0], ["A", 0.0]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.5);
    expect(scores.get("A")).toBeCloseTo(0.5);
    expect(scores.get("root")).toBeCloseTo(0.25);
  });

  it("missing rawSim defaults to 0 (root has none)", () => {
    const rawSims = new Map([["A1", 0.6]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A2")).toBeCloseTo(0);
  });

  it("handles a single-node tree (no edges)", () => {
    const scores = computeSubtreeScores("solo", new Map([["solo", 0.5]]), [], 0.95);
    expect(scores.get("solo")).toBeCloseTo(0.5);
  });
});

// ─── getStaleEmbeddableNodes ──────────────────────────────────────────────────

describe("getStaleEmbeddableNodes", () => {
  const MODEL = "test-model-v1";

  const INBOX: EmbeddableNode = {
    id: "inbox", name: "Inbox", description: null, instructions: null, examples: [], isRoot: true,
  };
  const ALPHA: EmbeddableNode = {
    id: "alpha", name: "Alpha", description: "Administrative coordination.", instructions: null,
    examples: [], isRoot: false,
  };
  const BETA: EmbeddableNode = {
    id: "beta", name: "Beta", description: "Media appearances and press.", instructions: null,
    examples: [], isRoot: false,
  };

  const nodes = [INBOX, ALPHA, BETA];
  const edges: TaxonomyEdgeInput[] = [
    { id: "e1", sourceNodeId: "inbox", targetNodeId: "alpha" },
    { id: "e2", sourceNodeId: "inbox", targetNodeId: "beta" },
  ];

  function freshHash(node: EmbeddableNode): string {
    const breadcrumb = `Inbox > ${node.name}`;
    const text = buildNodeEmbeddingText({ name: node.name, description: node.description!, breadcrumb });
    return hashEmbeddingInput(text, MODEL);
  }

  it("returns all non-root nodes when none have embeddings", () => {
    const stale = getStaleEmbeddableNodes(nodes, edges, MODEL);
    expect(stale.map((n) => n.id)).toContain("alpha");
    expect(stale.map((n) => n.id)).toContain("beta");
    expect(stale.map((n) => n.id)).not.toContain("inbox");
  });

  it("skips root nodes regardless of their embedding state", () => {
    const inboxWithEmbedding: EmbeddableNode = {
      ...INBOX,
      embeddingVector: [0.1, 0.2],
      embeddingModel: MODEL,
      embeddingTextHash: "some-hash",
    };
    const stale = getStaleEmbeddableNodes([inboxWithEmbedding, ALPHA], edges, MODEL);
    expect(stale.map((n) => n.id)).not.toContain("inbox");
  });

  it("skips nodes without a description", () => {
    const noDesc: EmbeddableNode = {
      id: "nodesc", name: "NoDesc", description: null, instructions: null, examples: [], isRoot: false,
    };
    const stale = getStaleEmbeddableNodes([noDesc], edges, MODEL);
    expect(stale).toHaveLength(0);
  });

  it("returns empty when all embeddings are current", () => {
    const freshAlpha: EmbeddableNode = {
      ...ALPHA, embeddingVector: [0.1, 0.2], embeddingModel: MODEL, embeddingTextHash: freshHash(ALPHA),
    };
    const freshBeta: EmbeddableNode = {
      ...BETA, embeddingVector: [0.3, 0.4], embeddingModel: MODEL, embeddingTextHash: freshHash(BETA),
    };
    const stale = getStaleEmbeddableNodes([INBOX, freshAlpha, freshBeta], edges, MODEL);
    expect(stale).toHaveLength(0);
  });

  it("detects nodes with wrong model as stale", () => {
    const wrongModel: EmbeddableNode = {
      ...ALPHA,
      embeddingVector: [0.1, 0.2],
      embeddingModel: "old-model",
      embeddingTextHash: freshHash(ALPHA), // hash is for right format but wrong model
    };
    const stale = getStaleEmbeddableNodes([INBOX, wrongModel], edges, MODEL);
    expect(stale.map((n) => n.id)).toContain("alpha");
  });

  it("detects nodes with empty vector as stale (missing embedding)", () => {
    const emptyVec: EmbeddableNode = {
      ...ALPHA, embeddingVector: [], embeddingModel: MODEL, embeddingTextHash: freshHash(ALPHA),
    };
    const stale = getStaleEmbeddableNodes([INBOX, emptyVec], edges, MODEL);
    expect(stale.map((n) => n.id)).toContain("alpha");
  });

  it("old-format hashes (name\\ndescription only) are detected as stale", () => {
    // Pre-path-aware format: "Alpha\nAdministrative coordination."
    const oldText = `${ALPHA.name}\n${ALPHA.description}`;
    const oldHash = hashEmbeddingInput(oldText, MODEL);
    const oldFormatNode: EmbeddableNode = {
      ...ALPHA, embeddingVector: [0.1, 0.2], embeddingModel: MODEL, embeddingTextHash: oldHash,
    };
    const stale = getStaleEmbeddableNodes([INBOX, oldFormatNode], edges, MODEL);
    // Old hash does not match new path-aware hash → detected as stale
    expect(stale.map((n) => n.id)).toContain("alpha");
  });

  it("only returns nodes whose hash does not match — fresh nodes excluded", () => {
    const freshAlpha: EmbeddableNode = {
      ...ALPHA, embeddingVector: [0.1, 0.2], embeddingModel: MODEL, embeddingTextHash: freshHash(ALPHA),
    };
    // Beta is stale (no vector)
    const stale = getStaleEmbeddableNodes([INBOX, freshAlpha, BETA], edges, MODEL);
    expect(stale.map((n) => n.id)).not.toContain("alpha");
    expect(stale.map((n) => n.id)).toContain("beta");
  });

  it("path change invalidates hash (breadcrumb differs)", () => {
    // Compute hash as if Alpha were a grandchild "Inbox > Parent > Alpha"
    const wrongBreadcrumb = "Inbox > Parent > Alpha";
    const wrongText = buildNodeEmbeddingText({
      name: ALPHA.name, description: ALPHA.description!, breadcrumb: wrongBreadcrumb,
    });
    const wrongHash = hashEmbeddingInput(wrongText, MODEL);
    const movedNode: EmbeddableNode = {
      ...ALPHA, embeddingVector: [0.1, 0.2], embeddingModel: MODEL, embeddingTextHash: wrongHash,
    };
    // In reality Alpha is a direct child of Inbox → "Inbox > Alpha"
    const stale = getStaleEmbeddableNodes([INBOX, movedNode], edges, MODEL);
    // Wrong breadcrumb hash → detected as stale
    expect(stale.map((n) => n.id)).toContain("alpha");
  });
});
