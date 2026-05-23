import { LLMOutputSchema, type ClassifyOutput, type TaxonomyEdgeInput, type TaxonomyNodeInput } from "./types.js";
import type { ClassificationPathStep } from "@amarnai/shared";

function reviewNeeded(explanation: string): ClassifyOutput {
  return {
    finalNodeId: null,
    path: [],
    confidence: 0,
    explanation,
    priority: "LOW",
    urgency: "UNKNOWN",
    riskLevel: "LOW",
    requiredAction: "REVIEW",
    sensitivity: "NORMAL",
    dueAt: null,
    suggestedNextStep: "ASK_USER",
    needsHumanReview: true,
  };
}

function extractJSON(text: string): unknown {
  const trimmed = text.trim();

  // Direct parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // Extract from markdown code block
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  // Grab the outermost {...}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new Error("No JSON object found in response");
}

export function parseAndValidateOutput(
  rawText: string,
  nodes: TaxonomyNodeInput[],
  edges: TaxonomyEdgeInput[]
): ClassifyOutput {
  // 1. Parse JSON
  let parsed: unknown;
  try {
    parsed = extractJSON(rawText);
  } catch (e) {
    return reviewNeeded(`Failed to parse LLM output as JSON: ${String(e)}`);
  }

  // 2. Schema validation
  const result = LLMOutputSchema.safeParse(parsed);
  if (!result.success) {
    return reviewNeeded(`LLM output schema validation failed: ${result.error.message}`);
  }
  const output = result.data;

  // 3. Validate each edgeId and build enriched path
  const edgeMap = new Map(edges.map((e) => [e.id, e]));
  const enrichedPath: ClassificationPathStep[] = [];

  for (const step of output.path) {
    const edge = edgeMap.get(step.edgeId);
    if (!edge) {
      // Unknown edge ID — local LLMs sometimes hallucinate path step IDs.
      // Drop the entire path and fall through to finalNodeId validation,
      // consistent with how disconnected and mis-rooted paths are handled below.
      enrichedPath.length = 0;
      break;
    }
    enrichedPath.push({
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      confidence: step.confidence,
      explanation: step.explanation,
    });
  }

  // 4. Validate edge chain connectivity — drop path on disconnection rather than failing,
  //    since the destination (finalNodeId) is what matters; the path is explanatory metadata.
  let pathIsConnected = true;
  for (let i = 0; i < enrichedPath.length - 1; i++) {
    const curr = enrichedPath[i]!;
    const next = enrichedPath[i + 1]!;
    if (curr.targetNodeId !== next.sourceNodeId) {
      pathIsConnected = false;
      break;
    }
  }
  let resolvedPath = pathIsConnected ? enrichedPath : [];

  // 5. Validate path starts from root node (if root is defined and path is non-empty)
  //    Drop the path rather than failing — finalNodeId is validated independently.
  const rootNode = nodes.find((n) => n.isRoot);
  if (resolvedPath.length > 0 && rootNode) {
    const firstEdge = resolvedPath[0]!;
    if (firstEdge.sourceNodeId !== rootNode.id) {
      resolvedPath = [];
      pathIsConnected = false;
    }
  }

  // 6. Validate finalNodeId: existence, then consistency with path
  //    Path-consistency is only enforced when the path was not dropped.
  if (output.finalNodeId !== null) {
    let finalNode = nodes.find((n) => n.id === output.finalNodeId);
    if (!finalNode) {
      // LLM sometimes returns the node name instead of the node id — resolve by name as fallback
      const byName = nodes.find(
        (n) => n.name.toLowerCase() === output.finalNodeId!.toLowerCase()
      );
      if (byName) {
        output.finalNodeId = byName.id;
        finalNode = byName;
        resolvedPath = [];
        pathIsConnected = false;
      } else {
        return reviewNeeded(`Unknown finalNodeId: "${output.finalNodeId}"`);
      }
    }

    if (pathIsConnected) {
      const expectedFinalNodeId =
        resolvedPath.length > 0
          ? resolvedPath[resolvedPath.length - 1]!.targetNodeId
          : rootNode?.id ?? null;

      if (expectedFinalNodeId !== null && output.finalNodeId !== expectedFinalNodeId) {
        resolvedPath = [];
        pathIsConnected = false;
      }
    }

    // 7. Root node cannot be a final destination
    if (finalNode && finalNode.isRoot) {
      return reviewNeeded(`Root node "${output.finalNodeId}" cannot be a final destination`);
    }
  }

  return {
    finalNodeId: output.finalNodeId,
    path: resolvedPath,
    confidence: output.confidence,
    explanation: output.explanation,
    priority: output.priority,
    urgency: output.urgency,
    riskLevel: output.riskLevel,
    requiredAction: output.requiredAction,
    sensitivity: output.sensitivity,
    dueAt: output.dueAt ?? null,
    suggestedNextStep: output.suggestedNextStep,
    needsHumanReview: output.needsHumanReview,
  };
}
