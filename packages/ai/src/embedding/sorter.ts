/**
 * Embedding-based email thread sorting algorithm.
 *
 * Sorts an incoming thread into the most specific appropriate node of a
 * user-defined taxonomy graph using three phases:
 *
 *   Phase 0 — Absolute quality gate:
 *     If max raw similarity across all visible nodes is below `thetaMin`, route
 *     to Inbox immediately. This is the only step that detects whether the email
 *     fits the taxonomy at all, before normalization destroys that information.
 *
 *   Phase 1 — Bottom-up subtree scores:
 *     Propagate scores from leaves to root. S(v) = best reachable similarity in
 *     the subtree rooted at v, decayed by `lambdaDepthDecay` per level.
 *
 *   Phase 3 — Cross-branch LLM trigger (evaluated before traversal):
 *     If the top two root-child subtree scores are within `crossBranchMargin`,
 *     embeddings cannot distinguish the main branches. The LLM resolves with the
 *     top-K candidates by raw similarity.
 *
 *   Phase 2 — Top-down traversal:
 *     Descend from root, at each node applying softmax over child subtree scores.
 *     Descent requires both spread (Δ = p(c*) − p(c**) > thetaSpread) and
 *     quality (raw_sim(c*) ≥ thetaDescent). Stop when either condition fails or
 *     a leaf is reached.
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
// Grid-search tuned (benchmark-constants.ts) against 11 labeled email fixtures
// with pre-computed nomic-embed-text vectors (2026-05-25).
// Score improved from 49.0 → 64.2 / 85 max across 4,096 combinations.
//
// THETA_MIN
//   Absolute quality gate. If the highest raw cosine similarity across all
//   non-root nodes is below this value, the thread doesn't fit the taxonomy at
//   all and routes immediately to Inbox — before normalisation (softmax) can
//   wash out the signal. Lowered from the original hand-tuned value, which
//   rejected legitimate emails.
//
// LAMBDA_DEPTH_DECAY
//   Multiplicative penalty applied per level during bottom-up subtree score
//   propagation. A score that originates two levels below a node is worth
//   λ² at that node. Keeps deeper matches from dominating shallow, semantically
//   weaker ancestors. Unchanged — the benchmark taxonomy is flat (depth 1), so
//   this constant was invariant across all top-scoring configurations.
//
// SOFTMAX_TEMPERATURE
//   Controls how sharply softmax concentrates probability on the highest-scoring
//   child at each traversal step. Lower → sharper distribution → the winner
//   needs a smaller absolute score advantage to earn a high probability, which
//   reduces spurious splits when scores are clustered. Lowered from the original.
//
// THETA_SPREAD
//   Minimum probability gap Δ = p(c*) − p(c**) required to descend into the
//   best child. Prevents descent when two siblings score similarly after softmax,
//   i.e., embeddings cannot clearly distinguish them. Unchanged for the same
//   reason as LAMBDA_DEPTH_DECAY above.
//
// THETA_DESCENT
//   Absolute floor on the best child's raw cosine similarity; descent is blocked
//   if raw_sim(c*) < theta_descent regardless of spread. Replaces the old
//   DELTA_DESCENT_MARGIN check (S(c*) > raw_sim(parent) + delta), which
//   incorrectly blocked descent when child and parent had equal raw similarity.
//   Set to 0.0 because: (a) the flat benchmark cannot tune it meaningfully, and
//   (b) structural intermediate nodes can legitimately have raw_sim = 0 when the
//   email only matches their descendants. Raise this only after validating
//   against a deep taxonomy.
//
// CROSS_BRANCH_MARGIN
//   If the top two root-child subtree scores differ by less than this, embeddings
//   alone cannot choose a main branch and the LLM takes over. Lowered from the
//   original, which over-triggered the LLM on cases where one branch was a clear
//   winner.

export const THETA_MIN = 0.15;
export const LAMBDA_DEPTH_DECAY = 0.85;
export const SOFTMAX_TEMPERATURE = 0.05;
export const THETA_SPREAD = 0.15;
export const THETA_DESCENT = 0.0;
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
    thetaDescent?: number;
    crossBranchMargin?: number;
    topKLlmCandidates?: number;
  }
): Promise<EmbeddingSortResult> {
  const thetaMin = options?.thetaMin ?? THETA_MIN;
  const lambdaDecay = options?.lambdaDepthDecay ?? LAMBDA_DEPTH_DECAY;
  const softmaxTemp = options?.softmaxTemperature ?? SOFTMAX_TEMPERATURE;
  const thetaSpread = options?.thetaSpread ?? THETA_SPREAD;
  const thetaDescent = options?.thetaDescent ?? THETA_DESCENT;
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
  let lastBestProb = 0;

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

    // Δ = p(c*) − p(c**): how much the best child stands out among siblings.
    // No children.length normalisation — the spread threshold θ_spread operates
    // directly on this raw probability gap, as specified.
    const spread = bestProb - secondBestProb;

    const bestChildSubtreeScore = subtreeScores.get(bestChildId) ?? 0;
    const bestChildRawSim = rawSims.get(bestChildId) ?? 0;

    // Record the probability at this level before deciding; used for confidence.
    lastBestProb = bestProb;

    // Descent requires both conditions (spec Phase 2, Steps 2–4):
    //   spreadOk  — best child is meaningfully differentiated from its siblings
    //   descentOk — best child is relevant to the email in absolute terms
    const spreadOk = spread > thetaSpread;
    const descentOk = bestChildRawSim >= thetaDescent;

    if (spreadOk && descentOk) {
      const edge = edges.find(
        (e) => e.sourceNodeId === currentNodeId && e.targetNodeId === bestChildId
      );
      if (edge) {
        traversalPath.push({
          edgeId: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          confidence: bestProb,
          explanation: `Subtree score ${bestChildSubtreeScore.toFixed(3)}, spread ${spread.toFixed(3)}`,
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

  // ── Return embedding-auto result ───────────────────────────────────────────
  //
  // Confidence is the softmax probability of the winning child at the level
  // where descent was last considered (spec confidence assignment).

  const finalNode = nodeMap.get(finalNodeId);

  return {
    finalNodeId,
    path: traversalPath,
    confidence: lastBestProb,
    explanation: `Embedding routing to "${finalNode?.name ?? finalNodeId}" (raw sim ${(rawSims.get(finalNodeId) ?? 0).toFixed(3)})`,
    needsHumanReview: false,
    decisionSource: "embedding_auto",
    rawSimilarities: rawSimsRecord,
    subtreeScores: subtreeScoresRecord,
    updatedNodeEmbeddings,
  };
}
