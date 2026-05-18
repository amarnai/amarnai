import { LLMOutputSchema, type ClassifyOutput, type TaxonomyEdgeInput, type TaxonomyNodeInput } from "./types.js";
import type { ClassificationPathStep } from "@genizor/shared";

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
      return reviewNeeded(`Unknown edgeId in path: "${step.edgeId}"`);
    }
    enrichedPath.push({
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sortingQuestion: edge.sortingQuestion,
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
  }

  // 7. Validate final destination using traversal policy (rules 3-5)
  if (output.finalNodeId !== null) {
    const node = nodes.find((n) => n.id === output.finalNodeId)!;

    const hasOutgoingEdges = edges.some((e) => e.sourceNodeId === node.id);

    if (hasOutgoingEdges) {
      // Rule 4/5: node is intermediate (has outgoing edges).
      // Rule 4: valid fallback only if visible and can receive emails.
      // Rule 5: if it cannot receive emails, no valid fallback exists — needs review.
      if (!node.isVisibleCategory || !node.canReceiveEmails) {
        return reviewNeeded(
          `Node "${output.finalNodeId}" has outgoing edges but cannot serve as a fallback destination (isVisibleCategory=${node.isVisibleCategory}, canReceiveEmails=${node.canReceiveEmails})`
        );
      }
      // Rule 4 satisfied: visible + receivable intermediate fallback is allowed.
    } else {
      // Rule 3: leaf node — must be visible and able to receive emails.
      if (!node.isVisibleCategory || !node.canReceiveEmails) {
        return reviewNeeded(
          `Node "${output.finalNodeId}" is not a valid email destination (isVisibleCategory=${node.isVisibleCategory}, canReceiveEmails=${node.canReceiveEmails})`
        );
      }
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
