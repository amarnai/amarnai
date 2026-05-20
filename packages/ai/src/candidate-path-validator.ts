import { z } from "zod";
import type { CandidatePath, CandidateEdgeStep } from "./candidate-selector.js";
import type { ClassificationPathStep } from "@amarnai/shared";

export const MIN_LLM_PATH_CONFIDENCE = 0.7;

const LLMPathSelectionSchema = z.object({
  selectedPathId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
  needsHumanReview: z.boolean(),
});

export type PathSelectionResult = {
  finalNodeId: string | null;
  path: ClassificationPathStep[];
  confidence: number;
  explanation: string;
  needsHumanReview: boolean;
};

function reviewNeeded(explanation: string): PathSelectionResult {
  return { finalNodeId: null, path: [], confidence: 0, explanation, needsHumanReview: true };
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

function buildPath(
  edgeSteps: CandidateEdgeStep[],
  confidence: number,
  explanation: string
): ClassificationPathStep[] {
  return edgeSteps.map((step) => ({
    edgeId: step.edgeId,
    sourceNodeId: step.sourceNodeId,
    targetNodeId: step.targetNodeId,
    sortingQuestion: step.sortingQuestion,
    confidence,
    explanation,
  }));
}

export function validatePathSelection(
  rawText: string,
  candidates: CandidatePath[]
): PathSelectionResult {
  // 1. Parse JSON
  let parsed: unknown;
  try {
    parsed = extractJSON(rawText);
  } catch (e) {
    return reviewNeeded(`Failed to parse LLM output as JSON: ${String(e)}`);
  }

  // 2. Schema validation
  const result = LLMPathSelectionSchema.safeParse(parsed);
  if (!result.success) {
    return reviewNeeded(`LLM output schema validation failed: ${result.error.message}`);
  }
  const output = result.data;

  // 3. Null selection or explicit review request
  if (output.selectedPathId === null || output.needsHumanReview) {
    return reviewNeeded(output.explanation);
  }

  // 4. selectedPathId must match a provided candidate by exact sequential-ID lookup
  const candidateByPathId = new Map(candidates.map((c, i) => [`candidate_${i}`, c]));
  const candidate = candidateByPathId.get(output.selectedPathId);
  if (!candidate) {
    return reviewNeeded(`Unknown path ID: "${output.selectedPathId}"`);
  }

  // 5. Confidence threshold
  if (output.confidence < MIN_LLM_PATH_CONFIDENCE) {
    return reviewNeeded(
      `Confidence ${output.confidence} is below minimum ${MIN_LLM_PATH_CONFIDENCE}: ${output.explanation}`
    );
  }

  // 6. Final destination policy: must be visible and able to receive emails
  if (!candidate.finalNodeIsVisible || !candidate.finalNodeCanReceive) {
    return reviewNeeded(
      `Selected path leads to an invalid destination (isVisible=${candidate.finalNodeIsVisible}, canReceive=${candidate.finalNodeCanReceive})`
    );
  }

  // 7. Path and finalNodeId come from the validated candidate — never from LLM output
  return {
    finalNodeId: candidate.finalNodeId,
    path: buildPath(candidate.edgeSteps, output.confidence, output.explanation),
    confidence: output.confidence,
    explanation: output.explanation,
    needsHumanReview: false,
  };
}
