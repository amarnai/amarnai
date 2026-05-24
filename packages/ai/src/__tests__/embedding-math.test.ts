import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  softmax,
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
  computeSubtreeScores,
} from "../embedding/math.js";
import type { TaxonomyEdgeInput } from "../types.js";

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
    // [2, 0] and [3, 0] are both in the same direction → similarity 1
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
  it("concatenates name and description with newline", () => {
    const text = buildNodeEmbeddingText({ name: "Weddings", description: "Wedding planning." });
    expect(text).toBe("Weddings\nWedding planning.");
  });

  it("is deterministic", () => {
    const node = { name: "Funerals", description: "Memorial services." };
    expect(buildNodeEmbeddingText(node)).toBe(buildNodeEmbeddingText(node));
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
});

// ─── computeSubtreeScores ─────────────────────────────────────────────────────

describe("computeSubtreeScores", () => {
  // Simple two-level taxonomy:
  //   root → A → A1 (leaf)
  //   root → A → A2 (leaf)
  //   root → B (leaf)
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
    // A: max(0.1, 0.95 * 0.8) = max(0.1, 0.76) = 0.76
    expect(scores.get("A")).toBeCloseTo(0.76);
  });

  it("large subtree does not dominate: max not sum", () => {
    // A has two children (A1=0.8, A2=0.7); B is a single leaf (0.75).
    // With sum, A would score higher; with max, A scores 0.95*0.8=0.76, B 0.75 → B remains competitive.
    const rawSims = new Map([["A1", 0.8], ["A2", 0.7], ["B", 0.75], ["A", 0.0]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A")).toBeCloseTo(0.76);
    expect(scores.get("B")).toBeCloseTo(0.75);
    // A's subtree score is only marginally above B's, not doubled.
    expect(scores.get("A")! - scores.get("B")!).toBeLessThan(0.1);
  });

  it("root node has no rawSim but gets score via children", () => {
    const rawSims = new Map([["A1", 0.8], ["A2", 0.2], ["B", 0.3], ["A", 0.1]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    // root: max(0, 0.95 * max(A=0.76, B=0.3)) = 0.95 * 0.76 = 0.722
    expect(scores.get("root")).toBeCloseTo(0.722);
  });

  it("decay factor propagates correctly across multiple levels", () => {
    const rawSims = new Map([["A1", 1.0], ["A2", 0.0], ["B", 0.0], ["A", 0.0]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.5);
    // A1 = 1.0, A = max(0, 0.5 * 1.0) = 0.5
    expect(scores.get("A")).toBeCloseTo(0.5);
    // root = max(0, 0.5 * max(A=0.5, B=0)) = 0.25
    expect(scores.get("root")).toBeCloseTo(0.25);
  });

  it("missing rawSim defaults to 0 (root has none)", () => {
    const rawSims = new Map([["A1", 0.6]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A2")).toBeCloseTo(0); // leaf with no rawSim
  });

  it("handles a single-node tree (no edges)", () => {
    const scores = computeSubtreeScores("solo", new Map([["solo", 0.5]]), [], 0.95);
    expect(scores.get("solo")).toBeCloseTo(0.5);
  });
});
