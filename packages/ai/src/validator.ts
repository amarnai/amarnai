import { LLMOutputSchema, type ClassifyOutput, type TaxonomyEdgeInput, type TaxonomyNodeInput } from "./types.js";

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

  // 3. Validate finalNodeId
  if (output.finalNodeId !== null) {
    const node = nodes.find((n) => n.id === output.finalNodeId);
    if (!node) {
      return reviewNeeded(`Unknown finalNodeId: "${output.finalNodeId}"`);
    }
    if (!node.isVisibleCategory || !node.canReceiveEmails) {
      return reviewNeeded(
        `Node "${output.finalNodeId}" is not a valid email destination (isVisibleCategory=${node.isVisibleCategory}, canReceiveEmails=${node.canReceiveEmails})`
      );
    }
  }

  // 4. Validate path node IDs
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const step of output.path) {
    if (!nodeIds.has(step.nodeId)) {
      return reviewNeeded(`Unknown nodeId in path: "${step.nodeId}"`);
    }
  }

  // 5. Validate path edges — consecutive path nodes must be connected by a real edge
  const edgeSet = new Set(edges.map((e) => `${e.sourceNodeId}\0${e.targetNodeId}`));
  for (let i = 0; i < output.path.length - 1; i++) {
    const from = output.path[i]!.nodeId;
    const to = output.path[i + 1]!.nodeId;
    if (!edgeSet.has(`${from}\0${to}`)) {
      return reviewNeeded(`No edge from "${from}" to "${to}" exists in the taxonomy`);
    }
  }

  return {
    finalNodeId: output.finalNodeId,
    path: output.path,
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
