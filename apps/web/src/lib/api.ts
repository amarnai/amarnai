const API_BASE = process.env["API_URL"] ?? "http://localhost:3001";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}`);
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
  categoryNode: { id: string; name: string };
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
  parentId: string | null;
  kind: "CATEGORY" | "RULE";
  name: string;
  description: string | null;
  positionX: number;
  positionY: number;
  syncToGmail: boolean;
  createdAt: string;
  updatedAt: string;
};

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
  categoryNode: { id: string; name: string; kind: string };
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
