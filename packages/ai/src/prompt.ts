import type { ClassifyInput, TaxonomyEdgeInput, TaxonomyNodeInput, ThreadMessage } from "./types.js";

const SYSTEM_PROMPT = `You are an email classification assistant. Classify an email thread into the most appropriate destination node in a taxonomy tree.

Rules:
- Start from the root node and follow edges toward leaf nodes
- Choose the node whose name and description best match the email content
- Prefer deeper, more specific nodes over broader ancestors
- Stop at a leaf node (no outgoing edges) unless a shallower node is clearly the better match
- If no node fits, set finalNodeId to null and needsHumanReview to true
- Record only the edges actually followed in "path"
- Classify the thread as a whole — weight the latest message most heavily
- If uncertain or no valid destination exists, set finalNodeId to null and needsHumanReview to true

Respond with ONLY valid JSON, no markdown:
{
  "finalNodeId": "the id: value of the destination node (not its name), or null",
  "path": [{"edgeId": "string", "confidence": 0.0, "explanation": "string"}],
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

function renderTaxonomyTree(nodes: TaxonomyNodeInput[], edges: TaxonomyEdgeInput[]): string {
  const root = nodes.find((n) => n.isRoot);
  if (!root) return "(no root node defined)";

  function renderNode(nodeId: string, indent: string, visited: Set<string>): string {
    if (visited.has(nodeId)) return `${indent}(cycle at ${nodeId})`;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return `${indent}(unknown node ${nodeId})`;

    const childVisited = new Set(visited);
    childVisited.add(nodeId);

    const outgoing = edges.filter((e) => e.sourceNodeId === nodeId);
    const flags: string[] = [];
    if (node.isRoot) flags.push("ROOT");
    if (outgoing.length === 0) flags.push("LEAF");

    const lines: string[] = [];
    lines.push(`${indent}${node.name} [${flags.join(", ")}] id:${node.id}`);
    if (node.description) lines.push(`${indent}  description: ${node.description}`);
    if (node.instructions) lines.push(`${indent}  instructions: ${node.instructions}`);
    if (node.examples.length > 0) lines.push(`${indent}  examples: ${node.examples.join("; ")}`);

    for (const edge of outgoing) {
      lines.push(`${indent}  → (edge:${edge.id})`);
      lines.push(renderNode(edge.targetNodeId, indent + "    ", childVisited));
    }

    return lines.join("\n");
  }

  return renderNode(root.id, "", new Set());
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
  const treeSection = renderTaxonomyTree(input.nodes, input.edges);

  const sorted = [...input.messages].sort((a, b) => {
    const da = a.receivedAt instanceof Date ? a.receivedAt : new Date(String(a.receivedAt));
    const db2 = b.receivedAt instanceof Date ? b.receivedAt : new Date(String(b.receivedAt));
    return da.getTime() - db2.getTime();
  });
  const messagesSection = sorted.map(formatMessage).join("\n\n");

  const user = `## Taxonomy (traverse from ROOT to LEAF)

${treeSection}

## Email thread (oldest first — latest message has highest weight)

${messagesSection}`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
