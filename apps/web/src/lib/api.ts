const API_BASE = process.env["API_URL"] ?? "http://localhost:3001";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function apiMutate<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  const hasBody = body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: hasBody ? { "Content-Type": "application/json" } : {},
    body: hasBody ? JSON.stringify(body) : null,
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `API ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Shared sub-types ─────────────────────────────────────────────────────────

export type EmailTag = {
  id: string;
  source: string;
  tag: { id: string; name: string; color: string | null };
};

export type ClassificationSummary = {
  id: string;
  priority: string;
  urgency: string;
  confidence: number;
  needsHumanReview: boolean;
  finalNode: { id: string; name: string } | null;
};

// ─── Resource types ───────────────────────────────────────────────────────────

export type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; email: string; name: string | null };
  members: Array<{
    id: string;
    role: string;
    user: { id: string; email: string; name: string | null };
  }>;
};

export type TaxonomyNode = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  instructions: string | null;
  examples: string[];
  isRoot: boolean;
  positionX: number;
  positionY: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaxonomyNodeInput = {
  name: string;
  description?: string; // required for non-root nodes; omit rather than pass null
  instructions?: string | null;
  examples?: string[];
  positionX?: number;
  positionY?: number;
};

export type UpdateTaxonomyNodeInput = Partial<CreateTaxonomyNodeInput>;

export type TaxonomyEdge = {
  id: string;
  workspaceId: string;
  sourceNodeId: string;
  targetNodeId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaxonomyEdgeInput = {
  sourceNodeId: string;
  targetNodeId: string;
};

export type UpdateTaxonomyEdgeInput = Record<string, never>;

export type Tag = {
  id: string;
  name: string;
  color: string | null;
  source: "AMARNAI" | "GMAIL";
  createdAt: string;
  updatedAt: string;
};

export type EmailThreadSummary = {
  id: string;
  subject: string | null;
  latestMessageAt: string | null;
  messageCount: number;
  createdAt: string;
  messages: Array<{
    id: string;
    senderEmail: string;
    senderName: string | null;
    snippet: string | null;
    receivedAt: string;
  }>;
  tags: EmailTag[];
  latestClassification: ClassificationSummary | null;
};

export type Classification = {
  id: string;
  confidence: number;
  explanation: string | null;
  priority: string;
  urgency: string;
  riskLevel: string;
  requiredAction: string;
  sensitivity: string;
  dueAt: string | null;
  suggestedNextStep: string;
  needsHumanReview: boolean;
  modelProvider: string | null;
  modelName: string | null;
  createdAt: string;
  finalNode: { id: string; name: string } | null;
};

export type EmailThreadDetail = {
  id: string;
  subject: string | null;
  latestMessageAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    senderEmail: string;
    senderName: string | null;
    subject: string | null;
    snippet: string | null;
    bodyText: string | null;
    receivedAt: string;
    hasAttachments: boolean;
    toEmails: unknown;
  }>;
  latestClassification: Classification | null;
  tags: EmailTag[];
  reviewItems: Array<{
    id: string;
    status: string;
    reason: string;
    createdAt: string;
  }>;
};

export type GmailConnection = {
  id: string;
  workspaceId: string;
  gmailAddress: string;
  grantedScopes: string[];
  status: "ACTIVE";
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
} | null;

export type ReviewItem = {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  emailThread: {
    id: string;
    subject: string | null;
    latestMessageAt: string | null;
    tags: EmailTag[];
  };
  emailMessage: {
    id: string;
    senderEmail: string;
    senderName: string | null;
    snippet: string | null;
  } | null;
  classification: ClassificationSummary | null;
};

export type MockInboxEventInput =
  | {
      mode: "new_thread";
      classifier?: "mock" | "ai";
      subject?: string | undefined;
      senderName?: string | undefined;
      senderEmail: string;
      bodyText: string;
    }
  | {
      mode: "existing_thread";
      classifier?: "mock" | "ai";
      threadId: string;
      senderName?: string | undefined;
      senderEmail: string;
      bodyText: string;
    };

export type MockInboxResult = {
  thread: {
    id: string;
    subject: string | null;
    messageCount: number;
    isNew: boolean;
  };
  classification: {
    id: string;
    finalNode: { id: string; name: string } | null;
    path: Array<{
      edgeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      confidence: number;
      explanation: string;
    }>;
    confidence: number;
    explanation: string;
    priority: string;
    urgency: string;
    riskLevel: string;
    requiredAction: string;
    sensitivity: string;
    suggestedNextStep: string;
    needsHumanReview: boolean;
    modelProvider?: string;
    modelName?: string;
  };
  reviewItemCreated: boolean;
  reviewItemId: string | null;
};

export type CandidatePathInput = {
  emails: Array<{
    subject?: string;
    senderEmail?: string;
    senderName?: string;
    bodyText?: string;
  }>;
  currentNodeId?: string;
};

export type CandidatePath = {
  pathId: string;
  edgeIds: string[];
  nodeIds: string[];
  finalNodeId: string;
  finalNodeName: string;
  finalNodeDescription: string | null;
  edgeSteps: Array<{
    edgeId: string;
    sourceNodeId: string;
    targetNodeId: string;
  }>;
  label: string;
  score: number;
  reasons: string[];
};

export type CandidatePathResult = {
  candidates: CandidatePath[];
  diagnostics: {
    queryText: string;
    matchedProfiles: string[];
    warnings: string[];
  };
};

export type LLMPathSelectionResult = {
  candidateResult: CandidatePathResult;
  rawLLMOutput: string | null;
  result: {
    finalNodeId: string | null;
    path: Array<{
      edgeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      confidence: number;
      explanation: string;
    }>;
    confidence: number;
    explanation: string;
    needsHumanReview: boolean;
  };
  debug?: {
    rawSelectedPathId: string | null;
    resolvedPathId: string | null;
    resolvedLabel: string | null;
    resolvedFinalNodeName: string | null;
  };
};

export type GmailRecentThreadsResult = {
  threads: Array<{ id: string; subject: string | null }>;
};

export type GmailSortResult = {
  snapshot: {
    providerThreadId: string;
    subject: string | null;
    messageCount: number;
    latestMessageAt: string;
    participants: string[];
  };
  classification: {
    id: string;
    finalNodeId: string | null;
    finalNodeName: string | null;
    path: Array<{
      edgeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      confidence: number;
      explanation: string;
    }>;
    confidence: number;
    explanation: string;
    priority: string;
    urgency: string;
    riskLevel: string;
    requiredAction: string;
    sensitivity: string;
    dueAt: string | null;
    suggestedNextStep: string;
    needsHumanReview: boolean;
    modelProvider: string | null;
    modelName: string | null;
  };
  reviewItemCreated: boolean;
  reviewItemId: string | null;
};

export type ClassifyResult = {
  classification: {
    id: string;
    finalNodeId: string | null;
    path: Array<{
      edgeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      confidence: number;
      explanation: string;
    }>;
    confidence: number;
    explanation: string;
    priority: string;
    urgency: string;
    riskLevel: string;
    requiredAction: string;
    sensitivity: string;
    dueAt: string | null;
    suggestedNextStep: string;
    needsHumanReview: boolean;
    modelProvider: string;
    modelName: string;
  };
  reviewItemCreated: boolean;
  reviewItemId: string | null;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

export const api = {
  workspaces: () => apiFetch<Workspace[]>("/workspaces"),
  gmailConnection: (workspaceId: string) =>
    apiFetch<GmailConnection>(`/workspaces/${workspaceId}/gmail-connection`),
  taxonomyNodes: (workspaceId: string) =>
    apiFetch<TaxonomyNode[]>(`/workspaces/${workspaceId}/taxonomy-nodes`),
  createTaxonomyNode: (workspaceId: string, input: CreateTaxonomyNodeInput) =>
    apiMutate<TaxonomyNode>(
      `/workspaces/${workspaceId}/taxonomy-nodes`,
      "POST",
      input
    ),
  updateTaxonomyNode: (
    workspaceId: string,
    nodeId: string,
    input: UpdateTaxonomyNodeInput
  ) =>
    apiMutate<TaxonomyNode>(
      `/workspaces/${workspaceId}/taxonomy-nodes/${nodeId}`,
      "PATCH",
      input
    ),
  deleteTaxonomyNode: (workspaceId: string, nodeId: string) =>
    apiMutate<{ ok: boolean }>(
      `/workspaces/${workspaceId}/taxonomy-nodes/${nodeId}`,
      "DELETE"
    ),
  taxonomyEdges: (workspaceId: string) =>
    apiFetch<TaxonomyEdge[]>(`/workspaces/${workspaceId}/taxonomy-edges`),
  createTaxonomyEdge: (workspaceId: string, input: CreateTaxonomyEdgeInput) =>
    apiMutate<TaxonomyEdge>(
      `/workspaces/${workspaceId}/taxonomy-edges`,
      "POST",
      input
    ),
  updateTaxonomyEdge: (workspaceId: string, edgeId: string, input: UpdateTaxonomyEdgeInput) =>
    apiMutate<TaxonomyEdge>(
      `/workspaces/${workspaceId}/taxonomy-edges/${edgeId}`,
      "PATCH",
      input
    ),
  deleteTaxonomyEdge: (workspaceId: string, edgeId: string) =>
    apiMutate<{ ok: boolean }>(
      `/workspaces/${workspaceId}/taxonomy-edges/${edgeId}`,
      "DELETE"
    ),
  tags: (workspaceId: string) =>
    apiFetch<Tag[]>(`/workspaces/${workspaceId}/tags`),
  emailThreads: (workspaceId: string) =>
    apiFetch<EmailThreadSummary[]>(`/workspaces/${workspaceId}/email-threads`),
  emailThread: (workspaceId: string, threadId: string) =>
    apiFetch<EmailThreadDetail>(
      `/workspaces/${workspaceId}/email-threads/${threadId}`
    ),
  reviewItems: (workspaceId: string) =>
    apiFetch<ReviewItem[]>(`/workspaces/${workspaceId}/review-items`),
  mockInboxEvent: (workspaceId: string, input: MockInboxEventInput) =>
    apiMutate<MockInboxResult>(
      `/dev/workspaces/${workspaceId}/mock-inbox-event`,
      "POST",
      input
    ),
  candidatePaths: (workspaceId: string, input: CandidatePathInput) =>
    apiMutate<CandidatePathResult>(
      `/dev/workspaces/${workspaceId}/candidate-paths`,
      "POST",
      input
    ),
  llmPathSelection: (workspaceId: string, input: CandidatePathInput) =>
    apiMutate<LLMPathSelectionResult>(
      `/dev/workspaces/${workspaceId}/llm-path-selection`,
      "POST",
      input
    ),
  gmailRecentThreads: (workspaceId: string) =>
    apiFetch<GmailRecentThreadsResult>(`/dev/workspaces/${workspaceId}/gmail-recent-threads`),
  sortGmailThread: (workspaceId: string, gmailThreadId: string) =>
    apiMutate<GmailSortResult>(
      `/dev/workspaces/${workspaceId}/gmail-sort-thread`,
      "POST",
      { gmailThreadId }
    ),
  aiClassify: (workspaceId: string, threadId: string) =>
    apiMutate<ClassifyResult>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/ai-classify`,
      "POST"
    ),
  mockClassifyThread: (workspaceId: string, threadId: string) =>
    apiMutate<ClassifyResult>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/mock-classify`,
      "POST"
    ),
};
