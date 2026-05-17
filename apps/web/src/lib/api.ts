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
  finalNode: { id: string; name: string };
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
  isVisibleCategory: boolean;
  canReceiveEmails: boolean;
  positionX: number;
  positionY: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaxonomyNodeInput = {
  name: string;
  description?: string | null;
  instructions?: string | null;
  examples?: string[];
  isVisibleCategory?: boolean;
  canReceiveEmails?: boolean;
  positionX?: number;
  positionY?: number;
};

export type UpdateTaxonomyNodeInput = Partial<CreateTaxonomyNodeInput>;

export type TaxonomyEdge = {
  id: string;
  workspaceId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sortingQuestion: string;
  examples: string[];
  negativeExamples: string[];
  priority: number;
  confidenceThreshold: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaxonomyEdgeInput = {
  sourceNodeId: string;
  targetNodeId: string;
  sortingQuestion: string;
  examples?: string[];
  negativeExamples?: string[];
  priority?: number;
  confidenceThreshold?: number | null;
};

export type UpdateTaxonomyEdgeInput = Partial<
  Omit<CreateTaxonomyEdgeInput, "sourceNodeId" | "targetNodeId">
>;

export type Tag = {
  id: string;
  name: string;
  color: string | null;
  source: "GENIZOR" | "GMAIL";
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
  createdAt: string;
  finalNode: { id: string; name: string };
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

// ─── API helpers ──────────────────────────────────────────────────────────────

export const api = {
  workspaces: () => apiFetch<Workspace[]>("/workspaces"),
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
};
