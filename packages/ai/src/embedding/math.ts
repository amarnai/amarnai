import { createHash } from "node:crypto";
import type { TaxonomyEdgeInput } from "../types.js";

// ─── Similarity ────────────────────────────────────────────────────────────────

/** Cosine similarity in [-1, 1]. Returns 0 for zero or mismatched-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Softmax ───────────────────────────────────────────────────────────────────

/**
 * Temperature-scaled softmax. Temperature < 1 sharpens the distribution;
 * temperature approaching 0 approaches argmax (one-hot).
 */
export function softmax(scores: number[], temperature: number): number[] {
  if (scores.length === 0) return [];
  const t = Math.max(temperature, 1e-8);
  const scaled = scores.map((s) => s / t);
  const maxVal = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - maxVal)); // numerically stable
  const sum = exps.reduce((acc, v) => acc + v, 0);
  return exps.map((v) => v / sum);
}

// ─── Embedding text builders ───────────────────────────────────────────────────

/** Deterministic input text for a non-root taxonomy node's embedding. */
export function buildNodeEmbeddingText(node: {
  name: string;
  description: string;
}): string {
  return `${node.name}\n${node.description}`;
}

/** Compact thread text for embedding (subject + bounded body excerpts). */
export function buildThreadEmbeddingText(
  messages: ReadonlyArray<{ subject?: string | null; bodyText?: string | null }>
): string {
  const parts: string[] = [];
  const firstSubject = messages[0]?.subject;
  if (firstSubject) parts.push(`Subject: ${firstSubject}`);
  for (const msg of messages) {
    if (msg.bodyText) {
      parts.push(msg.bodyText.slice(0, 500));
    }
  }
  return parts.join("\n\n");
}

// ─── Staleness hash ────────────────────────────────────────────────────────────

/** SHA-256 of `model::text`. Use to detect whether a stored embedding is stale. */
export function hashEmbeddingInput(text: string, model: string): string {
  return createHash("sha256").update(`${model}::${text}`).digest("hex");
}

// ─── Subtree scoring ───────────────────────────────────────────────────────────

/**
 * Compute bottom-up subtree scores from `rootId` downward.
 *
 * - Leaf:   S(node) = rawSim(node)
 * - Parent: S(node) = max(rawSim(node), lambdaDecay * max(S(child)))
 *
 * Large subtrees do not dominate because we use max, not sum.
 * `rawSims` typically has no entry for Inbox; it defaults to 0.
 */
export function computeSubtreeScores(
  rootId: string,
  rawSims: ReadonlyMap<string, number>,
  edges: ReadonlyArray<TaxonomyEdgeInput>,
  lambdaDecay: number
): Map<string, number> {
  const childrenMap = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenMap.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    childrenMap.set(edge.sourceNodeId, list);
  }

  const scores = new Map<string, number>();
  const visited = new Set<string>();

  function dfs(nodeId: string): number {
    if (visited.has(nodeId)) return scores.get(nodeId) ?? 0;
    visited.add(nodeId);

    const rawSim = rawSims.get(nodeId) ?? 0;
    const children = childrenMap.get(nodeId) ?? [];

    if (children.length === 0) {
      scores.set(nodeId, rawSim);
      return rawSim;
    }

    let maxChild = 0;
    for (const childId of children) {
      const s = dfs(childId);
      if (s > maxChild) maxChild = s;
    }

    const score = Math.max(rawSim, lambdaDecay * maxChild);
    scores.set(nodeId, score);
    return score;
  }

  dfs(rootId);
  return scores;
}
