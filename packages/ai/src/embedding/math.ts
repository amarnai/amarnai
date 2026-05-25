import { createHash } from "node:crypto";
import type { TaxonomyEdgeInput } from "../types.js";
import type { EmbeddableNode } from "./types.js";

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

/**
 * Deterministic input text for a non-root taxonomy node's embedding.
 *
 * Format (exact — whitespace is part of the hash input):
 *   Path: Inbox > Parent > Node
 *   Name: Node
 *   Description: Node description
 *
 * The breadcrumb is derived from the current taxonomy tree via `deriveBreadcrumb`
 * and is never stored as a node field in the database.
 */
export function buildNodeEmbeddingText(node: {
  name: string;
  description: string;
  breadcrumb: string;
}): string {
  return `Path: ${node.breadcrumb}\nName: ${node.name}\nDescription: ${node.description}`;
}

/**
 * Derives the breadcrumb string for a node by walking up the taxonomy tree.
 * Returns e.g. "Inbox > Parent > Node" for a node reachable from root.
 * Returns just the node name if the node has no parent in the edge list.
 * Guards against cycles with a visited set.
 *
 * This function is only called during embedding refresh — not on every sort.
 */
export function deriveBreadcrumb(
  nodeId: string,
  nodes: ReadonlyArray<{ id: string; name: string; isRoot: boolean }>,
  edges: ReadonlyArray<TaxonomyEdgeInput>
): string {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const parentMap = new Map<string, string>();
  for (const edge of edges) {
    parentMap.set(edge.targetNodeId, edge.sourceNodeId);
  }

  const names: string[] = [];
  const visited = new Set<string>();
  let current = nodeId;

  while (true) {
    if (visited.has(current)) break;
    visited.add(current);
    const node = nodeMap.get(current);
    if (!node) break;
    names.push(node.name);
    if (node.isRoot) break;
    const parent = parentMap.get(current);
    if (!parent) break;
    current = parent;
  }

  return names.reverse().join(" > ");
}

/**
 * Returns the IDs of all descendant nodes of `nodeId` (not including `nodeId`).
 * Uses BFS over outgoing edges.
 */
export function findDescendants(
  nodeId: string,
  edges: ReadonlyArray<TaxonomyEdgeInput>
): string[] {
  const childrenMap = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenMap.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    childrenMap.set(edge.sourceNodeId, list);
  }

  const result: string[] = [];
  const visited = new Set<string>([nodeId]);
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenMap.get(current) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      result.push(child);
      queue.push(child);
    }
  }

  return result;
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

// ─── Stale embedding detection ────────────────────────────────────────────────

/**
 * Returns the subset of `nodes` whose stored embedding is missing or stale
 * relative to the current embedding text (breadcrumb + name + description)
 * and the given `modelName`.
 *
 * Skips root nodes and nodes without descriptions — they are never embedded.
 * Use this to find which nodes need refreshing before sorting or in a backfill.
 */
export function getStaleEmbeddableNodes(
  nodes: ReadonlyArray<EmbeddableNode>,
  edges: ReadonlyArray<TaxonomyEdgeInput>,
  modelName: string
): EmbeddableNode[] {
  const result: EmbeddableNode[] = [];
  for (const n of nodes) {
    if (n.isRoot || n.description == null) continue;
    const breadcrumb = deriveBreadcrumb(n.id, nodes, edges);
    const text = buildNodeEmbeddingText({ name: n.name, description: n.description, breadcrumb });
    const expectedHash = hashEmbeddingInput(text, modelName);
    const isFresh =
      n.embeddingVector != null &&
      n.embeddingVector.length > 0 &&
      n.embeddingModel === modelName &&
      n.embeddingTextHash === expectedHash;
    if (!isFresh) result.push(n);
  }
  return result;
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
