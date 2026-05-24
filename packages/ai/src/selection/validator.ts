/**
 * Validates the LLM's node selection response against the provided candidate list.
 *
 * The LLM is expected to return a `selectedNodeId` of the form `"candidate_N"`.
 * Validation steps:
 *   1. Parse JSON (tolerating markdown fences).
 *   2. Schema validation (Zod).
 *   3. Reject null selection or explicit `needsHumanReview`.
 *   4. Map `selectedNodeId` → candidate by sequential index. Unknown IDs → review.
 *   5. Reject confidence below `MIN_LLM_NODE_CONFIDENCE`.
 *   6. Return `finalNodeId` from the validated candidate — never from LLM output —
 *      so the result is always consistent with the taxonomy graph.
 *
 * Path reconstruction (breadcrumbs, ClassificationPathStep[]) is intentionally
 * NOT done here. Callers reconstruct the path from the graph after receiving
 * the selected `finalNodeId`.
 *
 * Any failure returns a `reviewNeeded` result rather than throwing.
 */
import { z } from "zod";
import type { CandidateNode } from "./candidate-selector.js";

export const MIN_LLM_NODE_CONFIDENCE = 0.7;

const LLMNodeSelectionSchema = z.object({
  selectedNodeId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
  needsHumanReview: z.boolean(),
});

export type NodeSelectionResult = {
  finalNodeId: string | null;
  confidence: number;
  explanation: string;
  needsHumanReview: boolean;
};

function reviewNeeded(explanation: string): NodeSelectionResult {
  return { finalNodeId: null, confidence: 0, explanation, needsHumanReview: true };
}

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("No JSON object found in response");
}

export function validateNodeSelection(
  rawText: string,
  candidates: CandidateNode[]
): NodeSelectionResult {
  // 1. Parse JSON
  let parsed: unknown;
  try {
    parsed = extractJSON(rawText);
  } catch (e) {
    return reviewNeeded(`Failed to parse LLM output as JSON: ${String(e)}`);
  }

  // 2. Schema validation
  const result = LLMNodeSelectionSchema.safeParse(parsed);
  if (!result.success) {
    return reviewNeeded(`LLM output schema validation failed: ${result.error.message}`);
  }
  const output = result.data;

  // 3. Null selection or explicit review request
  if (output.selectedNodeId === null || output.needsHumanReview) {
    return reviewNeeded(output.explanation);
  }

  // 4. selectedNodeId must match a provided candidate by exact sequential-ID lookup
  const candidateByNodeId = new Map(candidates.map((c, i) => [`candidate_${i}`, c]));
  const candidate = candidateByNodeId.get(output.selectedNodeId);
  if (!candidate) {
    return reviewNeeded(`Unknown node ID: "${output.selectedNodeId}"`);
  }

  // 5. Confidence threshold
  if (output.confidence < MIN_LLM_NODE_CONFIDENCE) {
    return reviewNeeded(
      `Confidence ${output.confidence} is below minimum ${MIN_LLM_NODE_CONFIDENCE}: ${output.explanation}`
    );
  }

  // 6. finalNodeId comes from the validated candidate — never from LLM output
  return {
    finalNodeId: candidate.nodeId,
    confidence: output.confidence,
    explanation: output.explanation,
    needsHumanReview: false,
  };
}
