import type { ClassifyInput, TaxonomyEdgeInput, TaxonomyNodeInput, ThreadMessage } from "./types.js";

const SYSTEM_PROMPT = `You are an email classification assistant. Classify an email thread into the most appropriate destination node in a taxonomy tree.

Rules:
- Start from the root node and follow valid edges to a destination node
- Only follow edges that exist in the taxonomy
- The final node MUST have isVisibleCategory=true AND canReceiveEmails=true
- Classify the thread as a whole — weight the latest message most heavily
- If uncertain or no valid destination exists, set finalNodeId to null and needsHumanReview to true
- Never invent node IDs or edge IDs not present in the taxonomy
- The path must trace nodes visited from root to final node (inclusive)

Respond with ONLY valid JSON, no markdown:
{
  "finalNodeId": "string or null",
  "path": [{"nodeId": "string", "nodeName": "string"}],
  "confidence": 0.0,
  "explanation": "string",
  "priority": "LOW" | "MEDIUM" | "HIGH",
  "urgency": "NONE" | "SOON" | "TODAY" | "OVERDUE" | "UNKNOWN",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "requiredAction": "NONE" | "REPLY" | "REVIEW" | "APPROVE" | "SCHEDULE" | "PAY" | "DELEGATE" | "ARCHIVE" | "UNKNOWN",
  "sensitivity": "NORMAL" | "CONFIDENTIAL" | "PERSONAL_DATA" | "FINANCIAL" | "LEGAL" | "SECURITY",
  "dueAt": "ISO 8601 datetime or null",
  "suggestedNextStep": "LABEL_ONLY" | "CREATE_DRAFT" | "ASK_USER" | "OPEN_IN_GMAIL",
  "needsHumanReview": false
}`;

function formatNode(node: TaxonomyNodeInput): string {
  const lines = [
    `ID: ${node.id}`,
    `Name: ${node.name}`,
    `isVisibleCategory: ${node.isVisibleCategory}, canReceiveEmails: ${node.canReceiveEmails}, isRoot: ${node.isRoot}`,
  ];
  if (node.description) lines.push(`Description: ${node.description}`);
  if (node.instructions) lines.push(`Instructions: ${node.instructions}`);
  if (node.examples.length > 0) lines.push(`Examples: ${node.examples.join("; ")}`);
  return lines.map((l) => `  ${l}`).join("\n");
}

function formatEdge(edge: TaxonomyEdgeInput): string {
  const lines = [
    `Edge ID: ${edge.id}`,
    `From: ${edge.sourceNodeId} → To: ${edge.targetNodeId}`,
    `Sorting question: ${edge.sortingQuestion}`,
  ];
  if (edge.examples.length > 0) lines.push(`Positive examples: ${edge.examples.join("; ")}`);
  if (edge.negativeExamples.length > 0) lines.push(`Negative examples: ${edge.negativeExamples.join("; ")}`);
  return lines.map((l) => `  ${l}`).join("\n");
}

function formatMessage(msg: ThreadMessage, index: number): string {
  const date = msg.receivedAt instanceof Date
    ? msg.receivedAt.toISOString()
    : String(msg.receivedAt);
  const lines = [
    `--- Message ${index + 1} (receivedAt: ${date}) ---`,
    `From: ${msg.senderName ? `${msg.senderName} <${msg.senderEmail}>` : msg.senderEmail}`,
  ];
  if (msg.subject) lines.push(`Subject: ${msg.subject}`);
  lines.push(`Body:\n${msg.bodyText ?? "(no body)"}`);
  return lines.join("\n");
}

export function buildClassificationPrompt(input: ClassifyInput): Array<{ role: "system" | "user"; content: string }> {
  const root = input.nodes.find((n) => n.isRoot);
  const rootLine = root ? `Root node: ${root.id} "${root.name}"` : "No root node defined.";

  const nodesSection = input.nodes.map(formatNode).join("\n\n");
  const edgesSection = input.edges.length > 0
    ? input.edges.map(formatEdge).join("\n\n")
    : "  (no edges defined)";

  const sorted = [...input.messages].sort((a, b) => {
    const da = a.receivedAt instanceof Date ? a.receivedAt : new Date(String(a.receivedAt));
    const db2 = b.receivedAt instanceof Date ? b.receivedAt : new Date(String(b.receivedAt));
    return da.getTime() - db2.getTime();
  });
  const messagesSection = sorted.map(formatMessage).join("\n\n");

  const user = `## Taxonomy

${rootLine}

### Nodes:
${nodesSection}

### Edges (sourceNodeId → targetNodeId):
${edgesSection}

## Email thread (oldest first — latest message has highest weight)

${messagesSection}`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
