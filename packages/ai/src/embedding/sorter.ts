/**
 * Embedding-based email thread sorting algorithm.
 *
 * Replaces a single full-taxonomy LLM call with a two-phase approach:
 *   Phase 1 — Embedding auto-routing (no LLM):
 *     Embed each non-root taxonomy node (name + description) and the email thread
 *     (subject + bounded body). Compute cosine similarity, propagate scores
 *     bottom-up through the tree (subtree scoring), then greedily descend from
 *     the root, stopping when the decision is not confident enough.
 *
 *   Phase 2 — LLM fallback for ambiguous cases:
 *     If the top two root-branch subtree scores are within `crossBranchMargin`
 *     (cross-branch ambiguity), or a rival from a different branch scores close
 *     to the chosen destination (post-traversal rival check), the top-K candidates
 *     are sent to the LLM via `selectPathFromCandidates`. The LLM only sees opaque
 *     `candidate_N` IDs — never raw node or edge IDs — to prevent hallucination.
 *
 * Exported tuneable constants (`THETA_MIN`, `LAMBDA_DEPTH_DECAY`, etc.) let
 * callers and tests override the default thresholds via the `options` parameter
 * of `sortThreadByEmbedding`.
 *
 * Node embeddings are cached via `embeddingTextHash`; stale or missing embeddings
 * are recomputed and returned in `updatedNodeEmbeddings` for the caller to persist.
 */
import {
  cosineSimilarity,
  softmax,
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
  computeSubtreeScores,
  deriveBreadcrumb,
} from "./math.js";
import { selectNodeFromCandidates } from "../selection/select-path.js";
import type { EmbeddingProvider, EmbeddableNode, UpdatedNodeEmbedding } from "./types.js";
import type { AIProvider, TaxonomyEdgeInput, ThreadMessage } from "../types.js";
import type { ClassificationPathStep } from "@amarnai/shared";
import type { CandidateNode } from "../selection/candidate-selector.js";

// ─── Constants ────────────────────────────────────────────────────────────────
//
// Tuned by grid-search benchmark (benchmark-constants.ts) against 11 labeled
// email fixtures using pre-computed nomic-embed-text vectors (2026-05-25).
// Score improved from 49.0 → 64.2 / 85 max across 4,096 combinations.
//
// Changes vs original hand-tuned values:
//   THETA_MIN           0.25 → 0.15  (quality gate was rejecting legitimate emails)
//   SOFTMAX_TEMPERATURE 0.15 → 0.05  (sharper per-step distribution = fewer bad splits)
//   CROSS_BRANCH_MARGIN 0.08 → 0.05  (0.08 over-triggered LLM on easy, clear-winner cases)
//
// LAMBDA_DEPTH_DECAY, THETA_SPREAD, DELTA_DESCENT_MARGIN are unchanged — the
// benchmark taxonomy is flat (depth 1), so those constants were invariant across
// all top-scoring configurations. They retain values appropriate for multi-level
// taxonomies. Re-run the benchmark against a deep taxonomy to tune them.

export const THETA_MIN = 0.15;
export const LAMBDA_DEPTH_DECAY = 0.95;
export const SOFTMAX_TEMPERATURE = 0.05;
export const THETA_SPREAD = 0.25;
export const DELTA_DESCENT_MARGIN = 0.05;
export const CROSS_BRANCH_MARGIN = 0.05;
export const TOP_K_LLM_CANDIDATES = 5;

// ─── Result type ──────────────────────────────────────────────────────────────

export type DecisionSource = "embedding_auto" | "llm" | "inbox_fallback";

export type EmbeddingSortResult = {
  finalNodeId: string | null;
  path: ClassificationPathStep[];
  confidence: number;
  explanation: string;
  needsHumanReview: boolean;
  decisionSource: DecisionSource;
  /** Raw cosine similarity per non-root node. */
  rawSimilarities: Record<string, number>;
  /** Bottom-up subtree score per node. */
  subtreeScores: Record<string, number>;
  /** Embeddings recomputed during this call; persist these to avoid redundant work. */
  updatedNodeEmbeddings: UpdatedNodeEmbedding[];
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeInboxFallback(
  explanation: string,
  rawSimilarities: Record<string, number>,
  subtreeScores: Record<string, number>,
  updatedNodeEmbeddings: UpdatedNodeEmbedding[]
): EmbeddingSortResult {
  return {
    finalNodeId: null,
    path: [],
    confidence: 0,
    explanation,
    needsHumanReview: true,
    decisionSource: "inbox_fallback",
    rawSimilarities,
    subtreeScores,
    updatedNodeEmbeddings,
  };
}

/**
 * BFS path from `fromId` to `toId`, returning ClassificationPathStep[].
 * Returns [] if the two nodes are the same or no path exists.
 */
function buildClassificationPath(
  fromId: string,
  toId: string,
  edges: ReadonlyArray<TaxonomyEdgeInput>,
  confidence: number,
  explanation: string
): ClassificationPathStep[] {
  if (fromId === toId) return [];

  const childEdges = new Map<string, TaxonomyEdgeInput[]>();
  for (const edge of edges) {
    const list = childEdges.get(edge.sourceNodeId) ?? [];
    list.push(edge);
    childEdges.set(edge.sourceNodeId, list);
  }

  type Entry = { nodeId: string; path: ClassificationPathStep[] };
  const queue: Entry[] = [{ nodeId: fromId, path: [] }];
  const visited = new Set<string>([fromId]);

  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;
    for (const edge of childEdges.get(nodeId) ?? []) {
      if (visited.has(edge.targetNodeId)) continue;
      visited.add(edge.targetNodeId);
      const step: ClassificationPathStep = {
        edgeId: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        confidence,
        explanation,
      };
      const newPath = [...path, step];
      if (edge.targetNodeId === toId) return newPath;
      queue.push({ nodeId: edge.targetNodeId, path: newPath });
    }
  }
  return [];
}

/**
 * Build CandidateNode objects for the LLM resolver from a list of node IDs.
 * Breadcrumbs are included as read-only context; they are not selectable.
 * Path reconstruction from the selected node happens in the caller after
 * LLM resolution returns.
 */
function buildLlmCandidates(
  nodeIds: string[],
  nodeMap: Map<string, EmbeddableNode>,
  edges: ReadonlyArray<TaxonomyEdgeInput>,
  rootId: string
): CandidateNode[] {
  return nodeIds.flatMap((nodeId): CandidateNode[] => {
    const node = nodeMap.get(nodeId);
    if (!node) return [];

    // Build breadcrumb for LLM context only — never used as a selection target
    const pathSteps = buildClassificationPath(rootId, nodeId, edges, 1, "");
    const breadcrumbIds = [rootId, ...pathSteps.map((s) => s.targetNodeId)];
    const breadcrumb = breadcrumbIds.map((id) => nodeMap.get(id)?.name ?? "(unknown)").join(" → ");

    return [
      {
        nodeId,
        name: node.name,
        description: node.description,
        breadcrumb,
        score: 0,
        reasons: [],
      },
    ];
  });
}

/** Walk up from `nodeId` to find which direct child of `rootId` it belongs to. */
function findRootBranch(
  nodeId: string,
  rootId: string,
  edges: ReadonlyArray<TaxonomyEdgeInput>
): string | null {
  if (nodeId === rootId) return null;
  const parentMap = new Map<string, string>();
  for (const edge of edges) {
    parentMap.set(edge.targetNodeId, edge.sourceNodeId);
  }
  let current = nodeId;
  while (current !== rootId) {
    const parent = parentMap.get(current);
    if (!parent) return null;
    if (parent === rootId) return current;
    current = parent;
  }
  return null;
}

// ─── Main algorithm ───────────────────────────────────────────────────────────

export async function sortThreadByEmbedding(
  embeddingProvider: EmbeddingProvider,
  llmProvider: AIProvider,
  nodes: EmbeddableNode[],
  edges: TaxonomyEdgeInput[],
  messages: ThreadMessage[],
  options?: {
    thetaMin?: number;
    lambdaDepthDecay?: number;
    softmaxTemperature?: number;
    thetaSpread?: number;
    deltaDescentMargin?: number;
    crossBranchMargin?: number;
    topKLlmCandidates?: number;
  }
): Promise<EmbeddingSortResult> {
  const thetaMin = options?.thetaMin ?? THETA_MIN;
  const lambdaDecay = options?.lambdaDepthDecay ?? LAMBDA_DEPTH_DECAY;
  const softmaxTemp = options?.softmaxTemperature ?? SOFTMAX_TEMPERATURE;
  const thetaSpread = options?.thetaSpread ?? THETA_SPREAD;
  const deltaMargin = options?.deltaDescentMargin ?? DELTA_DESCENT_MARGIN;
  const crossBranchMargin = options?.crossBranchMargin ?? CROSS_BRANCH_MARGIN;
  const topKLlm = options?.topKLlmCandidates ?? TOP_K_LLM_CANDIDATES;

  // ── Step 1: Identify root ──────────────────────────────────────────────────

  const rootNode = nodes.find((n) => n.isRoot);
  if (!rootNode) {
    return makeInboxFallback("No root node in taxonomy", {}, {}, []);
  }

  const nonRootNodes = nodes.filter((n) => !n.isRoot && n.description != null);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // ── Step 2: Ensure non-root node embeddings are current ────────────────────
  //
  // Breadcrumbs are derived from the live taxonomy tree and are never stored
  // as a node field. They are pre-computed once here to avoid redundant work.

  const updatedNodeEmbeddings: UpdatedNodeEmbedding[] = [];
  const nodeEmbeddings = new Map<string, number[]>();

  const breadcrumbCache = new Map<string, string>();
  for (const n of nonRootNodes) {
    breadcrumbCache.set(n.id, deriveBreadcrumb(n.id, nodes, edges));
  }

  const staleNodes: EmbeddableNode[] = [];
  for (const n of nonRootNodes) {
    const breadcrumb = breadcrumbCache.get(n.id)!;
    const text = buildNodeEmbeddingText({ name: n.name, description: n.description!, breadcrumb });
    const expectedHash = hashEmbeddingInput(text, embeddingProvider.modelName);
    const isFresh =
      n.embeddingVector != null &&
      n.embeddingVector.length > 0 &&
      n.embeddingModel === embeddingProvider.modelName &&
      n.embeddingTextHash === expectedHash;

    if (isFresh) {
      nodeEmbeddings.set(n.id, n.embeddingVector!);
    } else {
      staleNodes.push(n);
    }
  }

  if (staleNodes.length > 0) {
    const texts = staleNodes.map((n) =>
      buildNodeEmbeddingText({
        name: n.name,
        description: n.description!,
        breadcrumb: breadcrumbCache.get(n.id)!,
      })
    );
    const vectors = await embeddingProvider.embed(texts);

    for (let i = 0; i < staleNodes.length; i++) {
      const node = staleNodes[i]!;
      const vector = vectors[i]!;
      const breadcrumb = breadcrumbCache.get(node.id)!;
      const text = buildNodeEmbeddingText({ name: node.name, description: node.description!, breadcrumb });
      const textHash = hashEmbeddingInput(text, embeddingProvider.modelName);
      nodeEmbeddings.set(node.id, vector);
      updatedNodeEmbeddings.push({
        nodeId: node.id,
        embeddingVector: vector,
        embeddingModel: embeddingProvider.modelName,
        embeddingTextHash: textHash,
        embeddingUpdatedAt: new Date(),
      });
    }
  }

  // Nodes with no description and no existing embedding get empty vectors
  for (const n of nodes.filter((n) => !n.isRoot)) {
    if (!nodeEmbeddings.has(n.id)) {
      nodeEmbeddings.set(n.id, []);
    }
  }

  // ── Step 3: Embed the thread ───────────────────────────────────────────────

  const threadText = buildThreadEmbeddingText(
    messages.map((m) => ({ subject: m.subject, bodyText: m.bodyText }))
  );
  const [threadVector] = await embeddingProvider.embed([threadText]);
  if (!threadVector || threadVector.length === 0) {
    return makeInboxFallback("Thread embedding failed", {}, {}, updatedNodeEmbeddings);
  }

  // ── Step 4: Raw cosine similarities ───────────────────────────────────────

  const rawSims = new Map<string, number>();
  for (const [nodeId, vector] of nodeEmbeddings) {
    rawSims.set(nodeId, vector.length > 0 ? cosineSimilarity(threadVector, vector) : 0);
  }
  const rawSimsRecord = Object.fromEntries(rawSims);

  // ── Step 5: Quality gate ───────────────────────────────────────────────────

  let maxRawSim = 0;
  for (const v of rawSims.values()) {
    if (v > maxRawSim) maxRawSim = v;
  }
  if (maxRawSim < thetaMin) {
    return makeInboxFallback(
      `Max similarity ${maxRawSim.toFixed(3)} below quality threshold ${thetaMin}`,
      rawSimsRecord,
      {},
      updatedNodeEmbeddings
    );
  }

  // ── Step 6: Bottom-up subtree scores ──────────────────────────────────────

  const subtreeScores = computeSubtreeScores(rootNode.id, rawSims, edges, lambdaDecay);
  const subtreeScoresRecord = Object.fromEntries(subtreeScores);

  // ── Step 7: Build children map for traversal ──────────────────────────────

  const childrenMap = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenMap.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    childrenMap.set(edge.sourceNodeId, list);
  }

  // ── Step 8: Cross-branch LLM trigger at Inbox ─────────────────────────────
  //
  // Before descending, check whether the top two root-child subtree scores
  // are close. If so, embeddings alone cannot confidently choose a branch.

  const rootChildren = childrenMap.get(rootNode.id) ?? [];
  const rootChildrenRanked = rootChildren
    .map((id) => ({ id, score: subtreeScores.get(id) ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const crossBranchAmbiguous =
    rootChildrenRanked.length >= 2 &&
    rootChildrenRanked[0]!.score - rootChildrenRanked[1]!.score < crossBranchMargin;

  if (crossBranchAmbiguous) {
    const topIds = rootChildrenRanked.slice(0, topKLlm).map((c) => c.id);
    const candidates = buildLlmCandidates(topIds, nodeMap, edges, rootNode.id);

    if (candidates.length > 0) {
      const llmResult = await selectNodeFromCandidates(llmProvider, { messages }, candidates);

      if (!llmResult.needsHumanReview && llmResult.finalNodeId) {
        // Reconstruct path from the graph after node selection
        const selectedPath = buildClassificationPath(
          rootNode.id,
          llmResult.finalNodeId,
          edges,
          llmResult.confidence,
          llmResult.explanation
        );
        return {
          finalNodeId: llmResult.finalNodeId,
          path: selectedPath,
          confidence: llmResult.confidence,
          explanation: llmResult.explanation,
          needsHumanReview: false,
          decisionSource: "llm",
          rawSimilarities: rawSimsRecord,
          subtreeScores: subtreeScoresRecord,
          updatedNodeEmbeddings,
        };
      }

      return makeInboxFallback(
        `LLM could not resolve cross-branch ambiguity: ${llmResult.explanation}`,
        rawSimsRecord,
        subtreeScoresRecord,
        updatedNodeEmbeddings
      );
    }
  }

  // ── Step 9: Top-down traversal ─────────────────────────────────────────────

  let currentNodeId = rootNode.id;
  const traversalPath: ClassificationPathStep[] = [];

  while (true) {
    const children = childrenMap.get(currentNodeId) ?? [];
    if (children.length === 0) break; // reached a leaf

    const childScoreList = children.map((id) => subtreeScores.get(id) ?? 0);
    const probs = softmax(childScoreList, softmaxTemp);

    // Find best and second-best by probability
    let bestIdx = 0;
    let secondBestIdx = -1;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i]! > probs[bestIdx]!) {
        secondBestIdx = bestIdx;
        bestIdx = i;
      } else if (secondBestIdx === -1 || probs[i]! > probs[secondBestIdx]!) {
        secondBestIdx = i;
      }
    }

    const bestChildId = children[bestIdx]!;
    const bestProb = probs[bestIdx]!;
    const secondBestProb = secondBestIdx >= 0 ? probs[secondBestIdx]! : 0;
    const spread = bestProb - secondBestProb;

    const bestChildSubtreeScore = subtreeScores.get(bestChildId) ?? 0;
    const currentRawSim = rawSims.get(currentNodeId) ?? 0;

    // Normalize spread by the number of children so that a clear winner produces
    // a consistent signal regardless of how many branches the current node has.
    // With k children, uniform softmax gives each child 1/k probability; the
    // "spread" (best − second-best) scales as roughly (1 − 1/k) for a perfect
    // winner and 0 for a tie. Multiplying by k removes that dependency on k,
    // making thetaSpread a model-agnostic dominance threshold.
    const normalizedSpread = spread * children.length;
    const spreadOk = normalizedSpread > thetaSpread;
    const marginOk = bestChildSubtreeScore > currentRawSim + deltaMargin;

    if (spreadOk && marginOk) {
      const edge = edges.find(
        (e) => e.sourceNodeId === currentNodeId && e.targetNodeId === bestChildId
      );
      if (edge) {
        traversalPath.push({
          edgeId: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          confidence: bestProb,
          explanation: `Subtree score ${bestChildSubtreeScore.toFixed(3)}, spread ${normalizedSpread.toFixed(3)} (normalized)`,
        });
      }
      currentNodeId = bestChildId;
    } else {
      // Stop: cannot confidently descend further.
      // The current node — including root (Inbox) — becomes the final destination.
      break;
    }
  }

  // Traversal halted here. If we stopped at root, Inbox is the final destination.
  if (currentNodeId === rootNode.id) {
    return {
      finalNodeId: rootNode.id,
      path: [],
      confidence: 0,
      explanation: `No child branch matched confidently; thread stays in Inbox`,
      needsHumanReview: false,
      decisionSource: "inbox_fallback",
      rawSimilarities: rawSimsRecord,
      subtreeScores: subtreeScoresRecord,
      updatedNodeEmbeddings,
    };
  }

  const finalNodeId = currentNodeId;

  // ── Step 10: Post-traversal global rival check ─────────────────────────────
  //
  // If a node from a different root branch has a subtree score within
  // CROSS_BRANCH_MARGIN of the chosen destination AND it has strong raw
  // similarity, embeddings alone are inconclusive — escalate to LLM.

  const finalNodeBranch = findRootBranch(finalNodeId, rootNode.id, edges);
  const finalSubtreeScore = subtreeScores.get(finalNodeId) ?? 0;

  let rivalId: string | null = null;
  let rivalScore = -Infinity;

  for (const [id, score] of subtreeScores) {
    if (id === rootNode.id || id === finalNodeId) continue;
    const branch = findRootBranch(id, rootNode.id, edges);
    if (branch === finalNodeBranch) continue; // same branch
    const rawSim = rawSims.get(id) ?? 0;
    if (rawSim < thetaMin) continue; // weak candidate
    if (score > rivalScore) {
      rivalScore = score;
      rivalId = id;
    }
  }

  if (
    rivalId !== null &&
    Math.abs(rivalScore - finalSubtreeScore) < crossBranchMargin &&
    (rawSims.get(finalNodeId) ?? 0) > thetaMin
  ) {
    const topIds = [finalNodeId, rivalId, ...rootChildrenRanked.slice(0, topKLlm - 2).map((c) => c.id)];
    const deduped = [...new Set(topIds)].slice(0, topKLlm);
    const candidates = buildLlmCandidates(deduped, nodeMap, edges, rootNode.id);

    if (candidates.length > 0) {
      const llmResult = await selectNodeFromCandidates(llmProvider, { messages }, candidates);

      if (!llmResult.needsHumanReview && llmResult.finalNodeId) {
        // Reconstruct path from the graph after node selection
        const selectedPath = buildClassificationPath(
          rootNode.id,
          llmResult.finalNodeId,
          edges,
          llmResult.confidence,
          llmResult.explanation
        );
        return {
          finalNodeId: llmResult.finalNodeId,
          path: selectedPath,
          confidence: llmResult.confidence,
          explanation: llmResult.explanation,
          needsHumanReview: false,
          decisionSource: "llm",
          rawSimilarities: rawSimsRecord,
          subtreeScores: subtreeScoresRecord,
          updatedNodeEmbeddings,
        };
      }

      return makeInboxFallback(
        `LLM could not resolve post-traversal cross-branch rival: ${llmResult.explanation}`,
        rawSimsRecord,
        subtreeScoresRecord,
        updatedNodeEmbeddings
      );
    }
  }

  // ── Return embedding-auto result ───────────────────────────────────────────

  const finalRawSim = rawSims.get(finalNodeId) ?? 0;
  const finalNode = nodeMap.get(finalNodeId);

  return {
    finalNodeId,
    path: traversalPath,
    confidence: Math.max(finalRawSim, 0.5),
    explanation: `Embedding routing to "${finalNode?.name ?? finalNodeId}" (raw sim ${finalRawSim.toFixed(3)})`,
    needsHumanReview: false,
    decisionSource: "embedding_auto",
    rawSimilarities: rawSimsRecord,
    subtreeScores: subtreeScoresRecord,
    updatedNodeEmbeddings,
  };
}
