type MessageInput = {
  subject?: string | null;
  senderEmail: string;
  senderName?: string | null;
  bodyText?: string | null;
};

type NodeInput = {
  id: string;
  name: string;
  isRoot: boolean;
  isVisibleCategory: boolean;
  canReceiveEmails: boolean;
};

type EdgeInput = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sortingQuestion: string;
};

type PathStep = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sortingQuestion: string;
  confidence: number;
  explanation: string;
};

export type MockClassificationResult = {
  finalNodeId: string;
  finalNodeName: string;
  path: PathStep[];
  confidence: number;
  explanation: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  urgency: "NONE" | "SOON" | "TODAY" | "OVERDUE" | "UNKNOWN";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  requiredAction: "NONE" | "REPLY" | "REVIEW" | "APPROVE" | "SCHEDULE" | "PAY" | "DELEGATE" | "ARCHIVE" | "UNKNOWN";
  sensitivity: "NORMAL" | "CONFIDENTIAL" | "PERSONAL_DATA" | "FINANCIAL" | "LEGAL" | "SECURITY";
  suggestedNextStep: "LABEL_ONLY" | "CREATE_DRAFT" | "ASK_USER" | "OPEN_IN_GMAIL";
  needsHumanReview: boolean;
};

const URGENCY_KEYWORDS = ["urgent", "asap", "immediately", "critical", "emergency", "deadline"];
const FINANCIAL_KEYWORDS = ["invoice", "payment", "pay", "bill", "financial", "finance"];
const PERSONAL_KEYWORDS = ["personal", "weekend", "coffee", "lunch", "family", "friend"];
const APPROVAL_KEYWORDS = ["approve", "approval", "sign off", "authorize"];

function findEdgePath(fromId: string, toId: string, edges: EdgeInput[]): EdgeInput[] | null {
  if (fromId === toId) return [];
  const queue: Array<{ nodeId: string; path: EdgeInput[] }> = [{ nodeId: fromId, path: [] }];
  const visited = new Set([fromId]);
  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;
    for (const edge of edges) {
      if (edge.sourceNodeId === nodeId && !visited.has(edge.targetNodeId)) {
        const newPath = [...path, edge];
        if (edge.targetNodeId === toId) return newPath;
        visited.add(edge.targetNodeId);
        queue.push({ nodeId: edge.targetNodeId, path: newPath });
      }
    }
  }
  return null;
}

export function mockClassify(
  messages: MessageInput[],
  nodes: NodeInput[],
  edges: EdgeInput[]
): MockClassificationResult {
  if (nodes.length === 0) {
    throw new Error("No taxonomy nodes available for classification");
  }

  const text = messages
    .flatMap((m) => [m.subject ?? "", m.senderEmail, m.senderName ?? "", m.bodyText ?? ""])
    .join(" ")
    .toLowerCase();

  const isUrgent = URGENCY_KEYWORDS.some((kw) => text.includes(kw));
  const isFinancial = FINANCIAL_KEYWORDS.some((kw) => text.includes(kw));
  const isPersonal = PERSONAL_KEYWORDS.some((kw) => text.includes(kw));
  const needsApproval = APPROVAL_KEYWORDS.some((kw) => text.includes(kw));

  const rootNode = nodes.find((n) => n.isRoot);

  // Rule 3: prefer true leaf nodes (visible, receivable, no outgoing edges)
  const hasOutgoing = new Set(edges.map((e) => e.sourceNodeId));
  const leafNodes = nodes.filter(
    (n) => n.canReceiveEmails && n.isVisibleCategory && !n.isRoot && !hasOutgoing.has(n.id)
  );
  // Rule 4: fall back to intermediate nodes (visible, receivable, has outgoing edges)
  const intermediateNodes = nodes.filter(
    (n) => n.canReceiveEmails && n.isVisibleCategory && !n.isRoot && hasOutgoing.has(n.id)
  );
  const pool = leafNodes.length > 0 ? leafNodes : intermediateNodes.length > 0 ? intermediateNodes : nodes;

  let bestNode = pool[0]!;
  let bestScore = -1;

  for (const node of pool) {
    const nameParts = node.name.toLowerCase().split(/[\s_-]+/);
    let score = 0;
    for (const part of nameParts) {
      if (part.length > 2 && text.includes(part)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  const confidence = bestScore > 0 ? Math.min(0.92, 0.6 + bestScore * 0.08) : 0.35;
  const needsHumanReview = confidence < 0.5;

  const priority: MockClassificationResult["priority"] =
    isUrgent ? "HIGH" : isFinancial ? "HIGH" : isPersonal ? "LOW" : "MEDIUM";
  const urgency: MockClassificationResult["urgency"] =
    isUrgent ? "TODAY" : isFinancial ? "SOON" : "NONE";
  const riskLevel: MockClassificationResult["riskLevel"] =
    isFinancial ? "HIGH" : isUrgent ? "MEDIUM" : "LOW";
  const sensitivity: MockClassificationResult["sensitivity"] =
    isFinancial ? "FINANCIAL" : isPersonal ? "PERSONAL_DATA" : "NORMAL";
  const requiredAction: MockClassificationResult["requiredAction"] =
    needsApproval ? "APPROVE" : isFinancial ? "PAY" : isUrgent ? "REPLY" : "NONE";
  const suggestedNextStep: MockClassificationResult["suggestedNextStep"] =
    needsHumanReview ? "ASK_USER" : "LABEL_ONLY";

  const traits: string[] = [];
  if (isUrgent) traits.push("urgent");
  if (isFinancial) traits.push("financial");
  if (isPersonal) traits.push("personal");
  if (needsApproval) traits.push("needs approval");

  const explanation =
    traits.length > 0
      ? `Classified as ${bestNode.name} (mock). Detected: ${traits.join(", ")}.`
      : `Classified as ${bestNode.name} (mock). No strong signal detected; confidence is low.`;

  // Build enriched path from edge traversal (BFS from root to best node)
  const edgePath = rootNode ? findEdgePath(rootNode.id, bestNode.id, edges) : null;
  const path: PathStep[] = edgePath
    ? edgePath.map((edge) => ({
        edgeId: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sortingQuestion: edge.sortingQuestion,
        confidence,
        explanation,
      }))
    : [];

  return {
    finalNodeId: bestNode.id,
    finalNodeName: bestNode.name,
    path,
    confidence,
    explanation,
    priority,
    urgency,
    riskLevel,
    requiredAction,
    sensitivity,
    suggestedNextStep,
    needsHumanReview,
  };
}
