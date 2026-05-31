const API_BASE = process.env["API_URL"] ?? "http://localhost:3001";

async function apiFetch<T>(path: string, revalidate?: number): Promise<T> {
  const next = revalidate !== undefined ? { next: { revalidate } } : { cache: "no-store" as RequestCache };
  const res = await fetch(`${API_BASE}${path}`, next);
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

export type TriageStatus = "PENDING" | "SORTED" | "NEEDS_REVIEW";

export type DoneMark = {
  userId: string;
  userName: string | null;
  userEmail: string;
  resolvedAt: string;
};

export type FolderCountsResult = {
  counts: { nodeId: string; count: number }[];
  total: number;
};

export type FilterCounts = {
  total: number;
  PENDING: number;
  NEEDS_REVIEW: number;
  SORTED: number;
};

export type EmailThreadListResult = {
  threads: EmailThreadSummary[];
  nextCursor: string | null;
  counts: FilterCounts;
};

export type EmailThreadSummary = {
  id: string;
  subject: string | null;
  providerThreadId: string;
  latestMessageAt: string | null;
  messageCount: number;
  triageStatus: TriageStatus;
  isClassifying: boolean;
  /** classifyingAt is set — a classify job is enqueued or in progress. */
  isQueued: boolean;
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
  hasDraft: boolean;
  isDrafting: boolean;
  doneMark: DoneMark | null;
};

export type Classification = {
  id: string;
  confidence: number;
  explanation: string | null;
  priority: string | null;
  urgency: string | null;
  riskLevel: string | null;
  requiredAction: string | null;
  sensitivity: string | null;
  dueAt: string | null;
  suggestedNextStep: string | null;
  needsHumanReview: boolean;
  decisionSource: string | null;
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
  triageStatus: TriageStatus;
  isClassifying: boolean;
  /** classifyingAt is set — a classify job is enqueued or in progress. */
  isQueued: boolean;
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
  doneMark: DoneMark | null;
};

export type GmailSyncSettings = {
  includeSpam: boolean;
  includePromotions: boolean;
  sortingPaused: boolean;
  blacklistedSenderEmails: string[];
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

export type BackfillStatus = "PENDING" | "RUNNING" | "DONE" | "ERROR";

export type SyncStatus = {
  status: "IDLE" | "SYNCING" | "ERROR";
  lastSyncedAt: string | null;
  errorMessage: string | null;
  backfillStatus: BackfillStatus;
  backfillSkipped: number;
  backfillCompletedAt: string | null;
  sortingPaused: boolean;
  workspacePlan: "FREE" | "PRO" | "BUSINESS";
} | null;

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
    confidence: number;
    explanation: string;
    priority: string | null;
    urgency: string | null;
    riskLevel: string | null;
    requiredAction: string | null;
    sensitivity: string | null;
    suggestedNextStep: string | null;
    needsHumanReview: boolean;
    modelProvider?: string;
    modelName?: string;
  };
};

export type CandidateNodeInput = {
  emails: Array<{
    subject?: string;
    senderEmail?: string;
    senderName?: string;
    bodyText?: string;
  }>;
  currentNodeId?: string;
};

export type CandidateNode = {
  nodeId: string;
  name: string;
  description: string | null;
  breadcrumb?: string;
  score: number;
  reasons: string[];
};

export type CandidateNodeResult = {
  candidates: CandidateNode[];
  diagnostics: {
    queryText: string;
    matchedProfiles: string[];
    warnings: string[];
  };
};

export type LLMNodeSelectionResult = {
  candidateResult: CandidateNodeResult;
  rawLLMOutput: string | null;
  result: {
    finalNodeId: string | null;
    confidence: number;
    explanation: string;
    needsHumanReview: boolean;
  };
  debug?: {
    rawSelectedNodeId: string | null;
    resolvedNodeId: string | null;
    resolvedBreadcrumb: string | null;
    resolvedName: string | null;
  };
};

export type GmailRecentThreadsResult = {
  threads: Array<{ id: string; subject: string | null }>;
};

export type GmailSortPathStep = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  confidence: number;
  explanation: string;
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
    confidence: number;
    explanation: string;
    needsHumanReview: boolean;
    decisionSource: string;
    modelProvider: string | null;
    modelName: string | null;
  };
  debug?: {
    path: GmailSortPathStep[];
    rawSimilarities: Record<string, number>;
    subtreeScores: Record<string, number>;
    nodeNames: Record<string, string>;
    updatedEmbeddingsCount: number;
  };
};

/** Returned by mock-classify (synchronous, result available immediately). */
export type ClassifyResult = {
  classification: {
    id: string;
    finalNodeId: string | null;
    confidence: number;
    explanation: string;
    needsHumanReview: boolean;
    decisionSource: string;
    modelProvider: string;
    modelName: string;
  };
};

/** Returned by ai-classify (async — job enqueued, poll isClassifying for completion). */
export type QueuedResult = { queued: true };

export type Draft = {
  id: string;
  subject: string | null;
  body: string;
  status: "GENERATING" | "PROPOSED" | "SENT" | string;
  createdAt: string;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

export const api = {
  workspaces: () => apiFetch<Workspace[]>("/workspaces"),
  gmailConnection: (workspaceId: string) =>
    apiFetch<GmailConnection>(`/workspaces/${workspaceId}/gmail-connection`),
  syncStatus: (workspaceId: string) =>
    apiFetch<SyncStatus>(`/workspaces/${workspaceId}/sync-status`),
  gmailSyncSettings: (workspaceId: string) =>
    apiFetch<GmailSyncSettings>(`/workspaces/${workspaceId}/gmail-sync-settings`),
  updateGmailSyncSettings: (workspaceId: string, patch: Partial<GmailSyncSettings>) =>
    apiMutate<GmailSyncSettings>(
      `/workspaces/${workspaceId}/gmail-sync-settings`,
      "PATCH",
      patch
    ),
  addBlacklistedEmail: (workspaceId: string, email: string) =>
    apiMutate<GmailSyncSettings>(
      `/workspaces/${workspaceId}/gmail-sync-settings/blacklist`,
      "POST",
      { email }
    ),
  removeBlacklistedEmail: (workspaceId: string, email: string) =>
    apiMutate<GmailSyncSettings>(
      `/workspaces/${workspaceId}/gmail-sync-settings/blacklist/${encodeURIComponent(email)}`,
      "DELETE"
    ),
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
  folderCounts: (workspaceId: string) =>
    apiFetch<FolderCountsResult>(`/workspaces/${workspaceId}/folder-counts`),
  emailThreads: (
    workspaceId: string,
    filters?: { nodeId?: string; status?: string; cursor?: string }
  ) => {
    const params = new URLSearchParams();
    if (filters?.nodeId)  params.set("nodeId",  filters.nodeId);
    if (filters?.status)  params.set("status",  filters.status);
    if (filters?.cursor)  params.set("cursor",  filters.cursor);
    const qs = params.toString();
    // Always no-store: cursor-based pages are ephemeral and must be fresh.
    return apiFetch<EmailThreadListResult>(
      `/workspaces/${workspaceId}/email-threads${qs ? `?${qs}` : ""}`,
      undefined
    );
  },
  emailThread: (workspaceId: string, threadId: string) =>
    apiFetch<EmailThreadDetail>(
      `/workspaces/${workspaceId}/email-threads/${threadId}`
    ),
  mockInboxEvent: (workspaceId: string, input: MockInboxEventInput) =>
    apiMutate<MockInboxResult>(
      `/dev/workspaces/${workspaceId}/mock-inbox-event`,
      "POST",
      input
    ),
  candidateNodes: (workspaceId: string, input: CandidateNodeInput) =>
    apiMutate<CandidateNodeResult>(
      `/dev/workspaces/${workspaceId}/candidate-paths`,
      "POST",
      input
    ),
  llmNodeSelection: (workspaceId: string, input: CandidateNodeInput) =>
    apiMutate<LLMNodeSelectionResult>(
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
  triageThread: (
    workspaceId: string,
    threadId: string,
    action: { action: "approve" } | { action: "move"; nodeId: string }
  ) =>
    apiMutate<{ ok: boolean; triageStatus: TriageStatus }>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/triage`,
      "PATCH",
      action
    ),
  markThreadDone: (workspaceId: string, threadId: string, userId: string) =>
    apiMutate<{ ok: boolean; doneMark: DoneMark }>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/resolve`,
      "POST",
      { userId }
    ),
  unmarkThreadDone: (workspaceId: string, threadId: string, userId: string) =>
    apiMutate<{ ok: boolean; doneMark: null }>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/resolve`,
      "DELETE",
      { userId }
    ),
  aiClassify: (workspaceId: string, threadId: string) =>
    apiMutate<QueuedResult>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/ai-classify`,
      "POST"
    ),
  aiTriage: (workspaceId: string, threadId: string) =>
    apiMutate<QueuedResult>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/ai-triage`,
      "POST"
    ),
  mockClassifyThread: (workspaceId: string, threadId: string) =>
    apiMutate<ClassifyResult>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/mock-classify`,
      "POST"
    ),
  sweepInbox: (workspaceId: string) =>
    apiMutate<{ ok: boolean; workspaceId: string }>(
      `/workspaces/${workspaceId}/sweep-inbox`,
      "POST"
    ),
  pauseSorting: (workspaceId: string) =>
    apiMutate<{ sortingPaused: boolean }>(
      `/workspaces/${workspaceId}/sorting-queue/pause`,
      "POST"
    ),
  resumeSorting: (workspaceId: string) =>
    apiMutate<{ sortingPaused: boolean; requeued: number }>(
      `/workspaces/${workspaceId}/sorting-queue/resume`,
      "POST"
    ),
  cancelClassify: (workspaceId: string, threadId: string) =>
    apiMutate<{ cancelled: boolean; jobRemoved: boolean }>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/classify`,
      "DELETE"
    ),
  startSorting: (workspaceId: string) =>
    apiMutate<{ ok: boolean; workspaceId: string }>(
      `/workspaces/${workspaceId}/sorting-queue/start`,
      "POST"
    ),
  generateDraft: (workspaceId: string, threadId: string) =>
    apiMutate<{ draft: Draft } | { generating: true }>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/generate-draft`,
      "POST"
    ),
  threadDrafts: (workspaceId: string, threadId: string) =>
    apiFetch<{ drafts: Draft[] }>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/drafts`
    ),
  dismissDraft: (workspaceId: string, threadId: string, draftId: string) =>
    apiMutate<{ ok: boolean }>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/drafts/${draftId}`,
      "DELETE"
    ),
  toggleDraftSent: (workspaceId: string, threadId: string, draftId: string, sent: boolean) =>
    apiMutate<{ draft: Draft }>(
      `/workspaces/${workspaceId}/email-threads/${threadId}/drafts/${draftId}`,
      "PATCH",
      { status: sent ? "SENT" : "PROPOSED" }
    ),
};
