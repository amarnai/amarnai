/**
 * Deterministic keyword-based pre-selection of candidate destination nodes.
 *
 * Given a taxonomy graph and a set of email inputs, enumerates every root→leaf
 * path via BFS, scores each final node against the tokenised email content, and
 * returns the top `MAX_CANDIDATE_PATHS` candidates as `CandidateNode` objects.
 *
 * Only node-level data (id, name, description, breadcrumb) is surfaced to
 * callers. Path and edge metadata used during scoring is kept internal.
 *
 * Scoring weights (per query token matched):
 *   - Final node name        × 3
 *   - Final node description × 2
 *   - Ancestor node names    × 1
 *   - Final node siblings    × 0.5
 *   - Instructions           × 1
 *   - Examples               × 1
 *
 * If more candidates than the cap exist, a named "fallback" node (e.g. "Other",
 * "Misc") is promoted to the last slot so the LLM always has an escape hatch.
 *
 * The result feeds directly into `buildCandidateNodePrompt`. The LLM never sees
 * raw node IDs — it only sees opaque `candidate_N` identifiers assigned at prompt
 * build time.
 */
import type { TaxonomyNodeInput, TaxonomyEdgeInput } from "../types.js";

export const MAX_CANDIDATE_PATHS = 15;

export type EmailInput = {
  subject?: string;
  senderEmail?: string;
  senderName?: string;
  bodyText?: string;
};

export type CandidateNode = {
  nodeId: string;
  name: string;
  description: string | null;
  /** Optional breadcrumb for LLM context (e.g. "Inbox → Support → Billing").
   *  For display/explanation only — never used as a selection target. */
  breadcrumb?: string;
  score: number;
  reasons: string[];
};

export type CandidateNodeResult = {
  candidates: CandidateNode[];
  diagnostics: {
    queryText: string;
    matchedProfiles: string[];
    warnings: string[];
  };
};

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "is", "it", "be", "as", "from", "this", "that", "are", "was",
  "were", "has", "have", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "i", "we", "you", "he", "she", "they",
  "me", "us", "him", "her", "them", "my", "your", "our", "his", "its", "their",
  "not", "no", "can", "into", "about", "up", "if", "so", "all", "please", "hi",
  "hello", "dear", "thanks", "thank", "regards", "best", "just", "also", "now",
  "re", "fw", "fwd",
]);

const FALLBACK_NAMES = new Set([
  "general", "other", "misc", "miscellaneous", "fallback", "default",
  "uncategorized", "catch-all", "catchall", "everything",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function scoreText(
  queryTokens: string[],
  text: string,
  weight: number
): { score: number; matched: string[] } {
  const textTokens = new Set(tokenize(text));
  const matched: string[] = [];
  for (const t of queryTokens) {
    if (textTokens.has(t)) matched.push(t);
  }
  return { score: matched.length * weight, matched };
}

type RawPath = { edgeIds: string[]; nodeIds: string[]; finalNodeId: string };

function enumeratePaths(rootId: string, edges: TaxonomyEdgeInput[]): RawPath[] {
  const childEdges = new Map<string, TaxonomyEdgeInput[]>();
  for (const edge of edges) {
    const list = childEdges.get(edge.sourceNodeId) ?? [];
    list.push(edge);
    childEdges.set(edge.sourceNodeId, list);
  }

  type QueueEntry = { edgeIds: string[]; nodeIds: string[]; visitedNodes: Set<string> };
  const result: RawPath[] = [];
  const queue: QueueEntry[] = [
    { edgeIds: [], nodeIds: [rootId], visitedNodes: new Set([rootId]) },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentNodeId = current.nodeIds[current.nodeIds.length - 1]!;
    const children = childEdges.get(currentNodeId) ?? [];

    for (const edge of children) {
      if (current.visitedNodes.has(edge.targetNodeId)) continue;

      const newNodeIds = [...current.nodeIds, edge.targetNodeId];
      const newEdgeIds = [...current.edgeIds, edge.id];
      const newVisited = new Set(current.visitedNodes);
      newVisited.add(edge.targetNodeId);

      result.push({ edgeIds: newEdgeIds, nodeIds: newNodeIds, finalNodeId: edge.targetNodeId });
      queue.push({ edgeIds: newEdgeIds, nodeIds: newNodeIds, visitedNodes: newVisited });
    }
  }

  return result;
}

// Internal scored node; breadcrumb is always present here (computed from path),
// and isFallback is stripped before returning to callers.
type ScoredNode = {
  nodeId: string;
  name: string;
  description: string | null;
  breadcrumb: string; // always set internally — optional only in the public CandidateNode type
  score: number;
  reasons: string[];
  isFallback: boolean;
};

function stripFallback(s: ScoredNode): CandidateNode {
  return {
    nodeId: s.nodeId,
    name: s.name,
    description: s.description,
    breadcrumb: s.breadcrumb,
    score: s.score,
    reasons: s.reasons,
  };
}

export function selectCandidateNodes(
  nodes: TaxonomyNodeInput[],
  edges: TaxonomyEdgeInput[],
  emails: EmailInput[],
  currentNodeId?: string
): CandidateNodeResult {
  const warnings: string[] = [];
  const matchedProfilesSet = new Set<string>();

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const rootNode = nodes.find((n) => n.isRoot);

  if (!rootNode) {
    warnings.push("No root node found; cannot enumerate paths.");
    return { candidates: [], diagnostics: { queryText: "", matchedProfiles: [], warnings } };
  }

  // Build sibling map: nodeId → names of sibling nodes (same parent)
  const childrenByParent = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenByParent.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    childrenByParent.set(edge.sourceNodeId, list);
  }
  const siblingMap = new Map<string, string[]>();
  for (const [, children] of childrenByParent) {
    for (const childId of children) {
      const existing = siblingMap.get(childId) ?? [];
      const newSibs = children
        .filter((id) => id !== childId)
        .map((id) => nodeMap.get(id)?.name)
        .filter((name): name is string => name !== undefined && name.length > 0);
      siblingMap.set(childId, [...new Set([...existing, ...newSibs])]);
    }
  }

  // Build query tokens from all email fields (never log raw body text)
  const rawTokens: string[] = [];
  for (const email of emails) {
    if (email.subject) rawTokens.push(...tokenize(email.subject));
    if (email.senderName) rawTokens.push(...tokenize(email.senderName));
    if (email.senderEmail) {
      const localPart = email.senderEmail.split("@")[0];
      if (localPart) rawTokens.push(...tokenize(localPart));
    }
    if (email.bodyText) rawTokens.push(...tokenize(email.bodyText));
  }
  const queryTokens = [...new Set(rawTokens)];
  const queryText = [...queryTokens].sort().join(" ");

  const rawPaths = enumeratePaths(rootNode.id, edges);
  const scored: ScoredNode[] = [];

  for (const raw of rawPaths) {
    const finalNode = nodeMap.get(raw.finalNodeId);
    if (!finalNode) continue;
    // Skip root and catch-all nodes as destinations — neither is a competitive
    // routing target (catch-all is assigned only by the automated-mail policy).
    if (finalNode.isRoot || finalNode.isCatchAll) continue;

    const reasons: string[] = [];
    let totalScore = 0;

    // Name (weight 3)
    const nameResult = scoreText(queryTokens, finalNode.name, 3);
    if (nameResult.matched.length > 0) {
      reasons.push(`name:${nameResult.matched.join(",")}`);
      matchedProfilesSet.add("name");
    }
    totalScore += nameResult.score;

    // Description (weight 2)
    if (finalNode.description) {
      const descResult = scoreText(queryTokens, finalNode.description, 2);
      if (descResult.matched.length > 0) {
        reasons.push(`desc:${descResult.matched.join(",")}`);
        matchedProfilesSet.add("description");
      }
      totalScore += descResult.score;
    }

    // Ancestor names (weight 1) — intermediate nodes between root and final
    const ancestorIds = raw.nodeIds.slice(1, -1);
    for (const ancestorId of ancestorIds) {
      const ancestor = nodeMap.get(ancestorId);
      if (ancestor) {
        const ancestorResult = scoreText(queryTokens, ancestor.name, 1);
        if (ancestorResult.matched.length > 0) {
          reasons.push(`ancestor:${ancestorResult.matched.join(",")}`);
          matchedProfilesSet.add("ancestor");
        }
        totalScore += ancestorResult.score;
      }
    }

    // Sibling names (weight 0.5)
    const siblings = siblingMap.get(raw.finalNodeId) ?? [];
    for (const siblingName of siblings) {
      const sibResult = scoreText(queryTokens, siblingName, 0.5);
      if (sibResult.matched.length > 0) {
        reasons.push(`sibling:${sibResult.matched.join(",")}`);
        matchedProfilesSet.add("sibling");
      }
      totalScore += sibResult.score;
    }

    // Instructions (weight 1)
    if (finalNode.instructions) {
      const instrResult = scoreText(queryTokens, finalNode.instructions, 1);
      if (instrResult.matched.length > 0) {
        reasons.push(`instructions:${instrResult.matched.join(",")}`);
        matchedProfilesSet.add("instructions");
      }
      totalScore += instrResult.score;
    }

    // Examples (weight 1)
    for (const example of finalNode.examples) {
      const exResult = scoreText(queryTokens, example, 1);
      if (exResult.matched.length > 0) {
        reasons.push(`example:${exResult.matched.join(",")}`);
        matchedProfilesSet.add("examples");
      }
      totalScore += exResult.score;
    }

    // Breadcrumb: full path from root, for LLM context only
    const pathNodeNames = raw.nodeIds.map((id) => nodeMap.get(id)?.name ?? "(unknown)");
    const breadcrumb = pathNodeNames.join(" → ");
    const isFallback = FALLBACK_NAMES.has(finalNode.name.toLowerCase());

    scored.push({
      nodeId: raw.finalNodeId,
      name: finalNode.name,
      description: finalNode.description,
      breadcrumb,
      score: Math.round(totalScore * 100) / 100,
      reasons: [...new Set(reasons)],
      isFallback,
    });
  }

  // Sort: score DESC, then nodeId ASC (deterministic tie-breaking)
  scored.sort((a, b) => b.score - a.score || (a.nodeId < b.nodeId ? -1 : 1));

  let candidates: CandidateNode[];

  if (scored.length <= MAX_CANDIDATE_PATHS) {
    candidates = scored.map(stripFallback);
  } else {
    const top = scored.slice(0, MAX_CANDIDATE_PATHS);
    const cutFallback = scored.slice(MAX_CANDIDATE_PATHS).find((s) => s.isFallback);

    if (cutFallback && !top.some((s) => s.isFallback)) {
      // Swap last slot with the highest-scoring cut fallback node
      top[MAX_CANDIDATE_PATHS - 1] = cutFallback;
      warnings.push(
        `Fallback node "${cutFallback.breadcrumb ?? cutFallback.name}" was promoted to the last candidate slot.`
      );
    }

    candidates = top.map(stripFallback);
  }

  if (candidates.length > 0 && candidates.every((c) => c.score === 0)) {
    warnings.push(
      "No token overlap between email and taxonomy nodes — all candidate scores are zero."
    );
  }

  if (currentNodeId !== undefined) {
    const inCandidates = candidates.some((c) => c.nodeId === currentNodeId);
    if (!inCandidates) {
      const currentNode = nodeMap.get(currentNodeId);
      if (currentNode) {
        warnings.push(
          `Current node "${currentNode.name}" is not among the top ${MAX_CANDIDATE_PATHS} candidates.`
        );
      }
    }
  }

  return {
    candidates,
    diagnostics: {
      queryText,
      matchedProfiles: [...matchedProfilesSet].sort(),
      warnings,
    },
  };
}
