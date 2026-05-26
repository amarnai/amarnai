/**
 * Embedding-based email thread sorting algorithm.
 *
 * Sorts an incoming thread into the most specific appropriate node of a
 * user-defined taxonomy graph using four phases:
 *
 *   Phase 1 — Bottom-up subtree scores:
 *     Propagate scores from leaves to root. S(v) = best reachable similarity in
 *     the subtree rooted at v, decayed by `lambdaDepthDecay` per level.
 *
 *   Phase 2 — Absolute quality gate (evaluated after Phase 1):
 *     If max subtree score across all nodes is below `thetaMin`, route to Inbox
 *     immediately.  Gating on subtree scores rather than raw similarities means
 *     the gate uses the same aggregated evidence as the traversal.  The two are
 *     logically equivalent (S(v) ≥ rawSim(v) for every v, so both thresholds
 *     fire iff all raw similarities are below `thetaMin`), but the gate now sits
 *     after Phase 1 so subtreeScores are available in the fallback result.
 *
 *   Phase 3 — Cross-branch LLM trigger:
 *     (a) Before traversal: if the top two root-child subtree scores are within
 *     `crossBranchMargin`, embeddings cannot distinguish the main branches; the
 *     LLM resolves with the top-K leaf candidates (collected via
 *     collectLeavesFromSubtrees, ranked by raw similarity) from those branches.
 *     (b) During traversal (mid-traversal): at each descent step, after picking
 *     the best child, any same-parent sibling within `crossBranchMargin` in
 *     subtree score that also has rawSim ≥ thetaMin triggers LLM escalation.
 *     Leaf candidates from all ambiguous branches are collected via
 *     collectLeavesFromSubtrees and the top-K by raw similarity are offered to the LLM.
 *
 *   Phase 4 — Top-down traversal:
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
// with pre-computed embedding vectors (2026-05-25).
// Score improved from 49.0 → 79.8 / 85 max across 4,096 combinations.
// (Quality gate moved to post-subtree-score Step 6: no benchmark change.)
//
// THETA_MIN
//   Absolute quality gate. If the highest subtree score across all nodes is
//   below this value, the thread doesn't fit the taxonomy at all and routes
//   immediately to Inbox. Gating on subtree scores (after Phase 1) rather than
//   raw similarities means the fallback result includes computed subtreeScores
//   and that the gate uses the same aggregated signal as the traversal.
//   Logically equivalent to a raw-sim gate since S(v) ≥ rawSim(v) ∀v.
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
//   If two sibling subtree scores differ by less than this, embeddings alone
//   cannot choose between the branches and the LLM takes over. Applied in two
//   places: (a) before traversal, comparing the top two root-child subtree
//   scores; (b) mid-traversal, comparing the best child's subtree score against
//   each same-parent sibling that also has rawSim ≥ thetaMin. Lowered from the
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

export type DecisionSource =
  | "embedding_auto"   // embedding traversal reached a non-root leaf/mid-node
  | "embedding_inbox"  // embedding traversal stopped at root (deliberate Inbox stay)
  | "llm"              // cross-branch ambiguity resolved by LLM
  | "inbox_fallback";  // catastrophic failure: quality gate, LLM error, no root, etc.

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
 *
 * `childEdges` must be pre-built by the caller (Map<sourceNodeId, edges[]>).
 * No internal fallback is provided — pass the map explicitly at every call site.
 */
function buildClassificationPath(
  fromId: string,
  toId: string,
  childEdges: ReadonlyMap<string, TaxonomyEdgeInput[]>,
  confidence: number,
  explanation: string
): ClassificationPathStep[] {
  if (fromId === toId) return [];

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
 *
 * `childEdges` must be pre-built by the caller (Map<sourceNodeId, edges[]>).
 */
function buildLlmCandidates(
  nodeIds: string[],
  nodeMap: Map<string, EmbeddableNode>,
  childEdges: ReadonlyMap<string, TaxonomyEdgeInput[]>,
  rootId: string,
  rawSims: ReadonlyMap<string, number>
): CandidateNode[] {
  return nodeIds.flatMap((nodeId): CandidateNode[] => {
    const node = nodeMap.get(nodeId);
    if (!node) {
      console.warn(`[buildLlmCandidates] nodeId "${nodeId}" not found in nodeMap — skipping`);
      return [];
    }

    // Build breadcrumb for LLM context only — never used as a selection target
    const pathSteps = buildClassificationPath(rootId, nodeId, childEdges, 1, "");
    const breadcrumbIds = [rootId, ...pathSteps.map((s) => s.targetNodeId)];
    const breadcrumb = breadcrumbIds.map((id) => nodeMap.get(id)?.name ?? "(unknown)").join(" → ");

    return [
      {
        nodeId,
        name: node.name,
        description: node.description,
        breadcrumb,
        score: rawSims.get(nodeId) ?? 0,
        reasons: [],
      },
    ];
  });
}

/**
 * Collect leaf nodes from a set of subtree roots using the caller's pre-built
 * childrenMap. For each root, descends via BFS and returns nodes with no
 * children. Falls back to the root itself if BFS finds no leaves (isolated
 * node or degenerate subgraph).
 *
 * Uses the childrenMap already built at Step 7 — never re-traverses the edge
 * list.
 */
function collectLeavesFromSubtrees(
  subtreeRoots: string[],
  childrenMap: Map<string, string[]>
): string[] {
  const result: string[] = [];
  for (const subtreeRoot of subtreeRoots) {
    const rootChildren = childrenMap.get(subtreeRoot) ?? [];
    if (rootChildren.length === 0) {
      // subtreeRoot is itself a leaf
      result.push(subtreeRoot);
      continue;
    }
    const leaves: string[] = [];
    const visited = new Set<string>([subtreeRoot]);
    const queue: string[] = [subtreeRoot];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = childrenMap.get(current) ?? [];
      if (children.length === 0) {
        leaves.push(current);
      } else {
        for (const child of children) {
          if (!visited.has(child)) {
            visited.add(child);
            queue.push(child);
          }
        }
      }
    }
    result.push(...(leaves.length > 0 ? leaves : [subtreeRoot]));
  }
  return result;
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

  // ── Step 5: Bottom-up subtree scores ──────────────────────────────────────

  const subtreeScores = computeSubtreeScores(rootNode.id, rawSims, edges, lambdaDecay);
  const subtreeScoresRecord = Object.fromEntries(subtreeScores);

  // ── Step 6: Quality gate ───────────────────────────────────────────────────
  //
  // Gate on the maximum subtree score rather than the maximum raw similarity.
  // S(v) = max(rawSim(v), λ·S(best_child)), so S(v) ≥ rawSim(v) for every
  // node; the gate is logically equivalent to the old raw-sim gate while
  // reflecting the aggregated descendant evidence that the rest of the
  // algorithm uses.  Reject when no subtree carries enough signal to be
  // useful — this fires for genuinely off-topic threads regardless of
  // taxonomy depth.

  let maxSubtreeScore = 0;
  for (const v of subtreeScores.values()) {
    if (v > maxSubtreeScore) maxSubtreeScore = v;
  }
  if (maxSubtreeScore < thetaMin) {
    return makeInboxFallback(
      `Max subtree score ${maxSubtreeScore.toFixed(3)} below quality threshold ${thetaMin}`,
      rawSimsRecord,
      subtreeScoresRecord,
      updatedNodeEmbeddings
    );
  }

  // ── Step 7: Build children map and edge lookup for traversal ─────────────

  const childrenMap = new Map<string, string[]>();
  const childEdges = new Map<string, TaxonomyEdgeInput[]>();
  const edgeByEndpoints = new Map<string, TaxonomyEdgeInput>();
  for (const edge of edges) {
    const list = childrenMap.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    childrenMap.set(edge.sourceNodeId, list);
    const edgeList = childEdges.get(edge.sourceNodeId) ?? [];
    edgeList.push(edge);
    childEdges.set(edge.sourceNodeId, edgeList);
    edgeByEndpoints.set(`${edge.sourceNodeId}:${edge.targetNodeId}`, edge);
  }

  // ── Step 8: Cross-branch LLM trigger at Inbox ─────────────────────────────
  //
  // Before descending, check whether the top two root-child subtree scores
  // are close. If so, embeddings alone cannot confidently choose a branch.
  //
  // Offer the LLM the most specific reachable destinations (leaves) from the
  // ambiguous branches, not the branch roots themselves. Root children are
  // intermediate nodes in deep taxonomies; giving the LLM leaf nodes lets it
  // make a direct, actionable decision. The same pattern is used mid-traversal.
  //
  // Guard: the second-best root child must also have subtreeScore ≥ thetaMin.
  // After the quality gate the best root child is guaranteed ≥ thetaMin/λ, but
  // the second-best may sit below thetaMin with no real signal. Arbitrating
  // between a viable branch and a signal-less one via LLM is wasteful and
  // misleading. subtreeScore (not rawSim) is the right metric here: root children
  // are often structural intermediates whose own rawSim is legitimately 0.

  const rootChildren = childrenMap.get(rootNode.id) ?? [];
  const rootChildrenRanked = rootChildren
    .map((id) => ({ id, score: subtreeScores.get(id) ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const crossBranchAmbiguous =
    rootChildrenRanked.length >= 2 &&
    rootChildrenRanked[0]!.score - rootChildrenRanked[1]!.score < crossBranchMargin &&
    rootChildrenRanked[1]!.score >= thetaMin;

  if (crossBranchAmbiguous) {
    const topIds = rootChildrenRanked.slice(0, topKLlm).map((c) => c.id);
    const leafCandidateIds = [...new Set(collectLeavesFromSubtrees(topIds, childrenMap))]
      .sort((a, b) => (rawSims.get(b) ?? 0) - (rawSims.get(a) ?? 0))
      .slice(0, topKLlm);
    const candidates = buildLlmCandidates(leafCandidateIds, nodeMap, childEdges, rootNode.id, rawSims);

    if (candidates.length > 0) {
      const llmResult = await selectNodeFromCandidates(llmProvider, { messages }, candidates);

      if (!llmResult.needsHumanReview && llmResult.finalNodeId) {
        // Reconstruct path from the graph after node selection
        const selectedPath = buildClassificationPath(
          rootNode.id,
          llmResult.finalNodeId,
          childEdges,
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

    // Δ_norm: k-invariant spread.
    //
    // Raw spread Δ = p(c*) − p(c**) shrinks as k grows because each runner-up
    // absorbs a share of the probability mass (for fixed softmax scores, Δ ≈
    // (α−1)/(α+k−1) where α = e^{Δscore/T}, so Δ → 0 as k → ∞ even when the
    // winner is unambiguous).
    //
    // We normalise by the maximum raw spread achievable with a uniform background
    // of k−1 siblings, which is (1 − 1/k):
    //
    //   Δ_norm = Δ / (1 − 1/max(k, 3))
    //
    // A perfect winner (p* → 1) gives Δ_norm → 1/(1 − 1/k) ≈ 1 for large k.
    // A tie (Δ = 0) gives Δ_norm = 0 regardless of k.
    // The θ_spread threshold is therefore consistent across nodes with different
    // fan-out, so the same constant works for shallow and wide subtrees alike.
    //
    // Floor is 3 (not 2): for k=2, the denominator (1−½=0.5) would double the
    // raw spread, making very small gaps (e.g. 0.17 vs 0.16 → Δ≈0.10) clear
    // the threshold despite being near-ties. Treating k<3 as k=3 caps the
    // amplification at 1.5× and keeps the threshold meaningful.
    const spread = bestProb - secondBestProb;
    const normalizedSpread = spread / (1 - 1 / Math.max(children.length, 3));

    const bestChildSubtreeScore = subtreeScores.get(bestChildId) ?? 0;
    const bestChildRawSim = rawSims.get(bestChildId) ?? 0;

    // Descent requires both conditions (spec Phase 2, Steps 2–4):
    //   spreadOk  — best child is meaningfully differentiated from its siblings
    //   descentOk — best child is relevant to the email in absolute terms
    const spreadOk = normalizedSpread > thetaSpread;
    const descentOk = bestChildRawSim >= thetaDescent;

    if (spreadOk && descentOk) {
      // Mid-traversal cross-branch check: even when spread is sufficient to
      // descend, check whether any same-parent sibling is within
      // crossBranchMargin in subtree score and has rawSim ≥ thetaMin. If so,
      // embeddings cannot reliably distinguish these branches at this level —
      // escalate to LLM with leaf candidates from all ambiguous branches.
      const midAmbiguousSiblings = children.filter((id) => {
        if (id === bestChildId) return false;
        const gap = bestChildSubtreeScore - (subtreeScores.get(id) ?? 0);
        return gap < crossBranchMargin && (rawSims.get(id) ?? 0) >= thetaMin;
      });

      if (midAmbiguousSiblings.length > 0) {
        const candidateIds = [...new Set(collectLeavesFromSubtrees(
          [bestChildId, ...midAmbiguousSiblings],
          childrenMap
        ))];
        const topCandidateIds = candidateIds
          .sort((a, b) => (rawSims.get(b) ?? 0) - (rawSims.get(a) ?? 0))
          .slice(0, topKLlm);
        const candidates = buildLlmCandidates(topCandidateIds, nodeMap, childEdges, rootNode.id, rawSims);
        if (candidates.length > 0) {
          const llmResult = await selectNodeFromCandidates(llmProvider, { messages }, candidates);
          if (!llmResult.needsHumanReview && llmResult.finalNodeId) {
            const selectedPath = buildClassificationPath(
              rootNode.id, llmResult.finalNodeId, childEdges,
              llmResult.confidence, llmResult.explanation
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
            `LLM could not resolve mid-traversal ambiguity at "${nodeMap.get(currentNodeId)?.name ?? currentNodeId}": ${llmResult.explanation}`,
            rawSimsRecord, subtreeScoresRecord, updatedNodeEmbeddings
          );
        }
      }

      // No mid-traversal ambiguity — descend normally.
      const edge = edgeByEndpoints.get(`${currentNodeId}:${bestChildId}`);
      if (edge) {
        traversalPath.push({
          edgeId: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          confidence: bestChildRawSim,
          explanation: `Subtree score ${bestChildSubtreeScore.toFixed(3)}, spread ${normalizedSpread.toFixed(3)} (raw ${spread.toFixed(3)})`,
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
  // This is a deliberate, confident decision (no branch was clear enough to descend
  // into), so decisionSource is "embedding_inbox" — distinct from "inbox_fallback"
  // which signals a catastrophic failure (null finalNodeId, needsHumanReview: true).
  if (currentNodeId === rootNode.id) {
    return {
      finalNodeId: rootNode.id,
      path: [],
      confidence: 0,
      explanation: `No child branch matched confidently; thread stays in Inbox`,
      needsHumanReview: false,
      decisionSource: "embedding_inbox",
      rawSimilarities: rawSimsRecord,
      subtreeScores: subtreeScoresRecord,
      updatedNodeEmbeddings,
    };
  }

  const finalNodeId = currentNodeId;

  // ── Return embedding-auto result ───────────────────────────────────────────
  //
  // Confidence is the raw cosine similarity of the final node — the actual
  // quality signal, bounded by [THETA_MIN, 1]. Using lastBestProb (softmax
  // probability) would depend on sibling count and temperature rather than
  // absolute match quality, and Math.max(..., 0.5) lied to callers when the
  // similarity was just above THETA_MIN.

  const finalNode = nodeMap.get(finalNodeId);
  const finalRawSim = rawSims.get(finalNodeId) ?? 0;

  return {
    finalNodeId,
    path: traversalPath,
    confidence: finalRawSim,
    explanation: `Embedding routing to "${finalNode?.name ?? finalNodeId}" (raw sim ${finalRawSim.toFixed(3)})`,
    needsHumanReview: false,
    decisionSource: "embedding_auto",
    rawSimilarities: rawSimsRecord,
    subtreeScores: subtreeScoresRecord,
    updatedNodeEmbeddings,
  };
}
