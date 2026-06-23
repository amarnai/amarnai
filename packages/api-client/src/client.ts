import type { TaxonomyTransferFile } from "@amarnai/shared";
import type { ApiTransport, TransportInit } from "./transport.js";
import type {
  Workspace,
  TaxonomyNode,
  CreateTaxonomyNodeInput,
  UpdateTaxonomyNodeInput,
  TaxonomyEdge,
  CreateTaxonomyEdgeInput,
  UpdateTaxonomyEdgeInput,
  GmailConnection,
  ConnectGmailInput,
  DisconnectResult,
  SyncStatus,
  GmailSyncSettings,
  FolderCountsResult,
  EmailThreadListResult,
  EmailThreadDetail,
  TriageStatus,
  DoneMark,
  Draft,
  GenerateDraftResult,
  MockInboxEventInput,
  MockInboxResult,
  CandidateNodeInput,
  CandidateNodeResult,
  LLMNodeSelectionResult,
  GmailRecentThreadsResult,
  GmailSortResult,
  ClassifyResult,
  QueuedResult,
  OkResult,
  QuotaInfo,
  RegisterPushDeviceInput,
  RegisterPushDeviceResult,
  CurrentUser,
  UpdateCurrentUserInput,
} from "./types.js";

export function makeApiClient(transport: ApiTransport) {
  const base = transport.baseUrl;

  async function apiFetch<T>(path: string, opts?: { revalidate?: number }): Promise<T> {
    const init: TransportInit =
      opts?.revalidate !== undefined
        ? { next: { revalidate: opts.revalidate } }
        : { cache: "no-store" };
    const res = await transport.fetch(`${base}${path}`, init);
    if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
    return res.json() as Promise<T>;
  }

  async function apiMutate<T>(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown
  ): Promise<T> {
    const hasBody = body !== undefined;
    const res = await transport.fetch(`${base}${path}`, {
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

  // Returns raw Response for endpoints that need custom status-code handling.
  async function apiRequest(path: string, init: TransportInit): Promise<Response> {
    return transport.fetch(`${base}${path}`, init);
  }

  return {
    // Authenticated identity for the current access token. Native clients read
    // emailVerified here to gate app access after sign-up.
    me: () => apiFetch<CurrentUser>("/auth/me"),

    // Re-send the email-verification link for the signed-in user. The API
    // throttles to one request per minute and returns 429 past that.
    resendVerification: () => apiMutate<OkResult>("/auth/resend-verification", "POST"),

    // Update the authenticated user's profile/preferences. Partial: only the
    // provided fields change (name empty string clears it).
    updateMe: (input: UpdateCurrentUserInput) =>
      apiMutate<CurrentUser>("/auth/me", "PATCH", input),

    // Permanently delete the authenticated user's account and all owned data.
    deleteMe: () => apiMutate<OkResult>("/auth/me", "DELETE"),

    workspaces: () =>
      apiFetch<Workspace[]>("/workspaces"),

    // Create a free workspace for the authenticated user. Returns 409 if the
    // user already owns a free workspace (paid creation happens on the web).
    createWorkspace: (name: string) =>
      apiMutate<Workspace>("/workspaces", "POST", { name }),

    // Rename a workspace (OWNER only). Returns the updated workspace.
    updateWorkspace: (workspaceId: string, name: string) =>
      apiMutate<Workspace>(`/workspaces/${workspaceId}`, "PATCH", { name }),

    // Wipe a workspace's Gmail connection, synced emails, and taxonomy back to
    // Inbox (OWNER only). Keeps the workspace and its members.
    resetWorkspace: (workspaceId: string) =>
      apiMutate<OkResult>(`/workspaces/${workspaceId}/reset`, "POST"),

    // Permanently delete a workspace and all its data (OWNER only). The API
    // rejects deleting the user's only owned workspace.
    deleteWorkspace: (workspaceId: string) =>
      apiMutate<OkResult>(`/workspaces/${workspaceId}`, "DELETE"),

    gmailConnection: (workspaceId: string) =>
      apiFetch<GmailConnection>(`/workspaces/${workspaceId}/gmail-connection`),

    // Connect (or reconnect) Gmail for the workspace. Accepts the serverAuthCode
    // from the mobile Google Sign-In. Owner-only. Returns the updated connection.
    connectGmail: (workspaceId: string, input: ConnectGmailInput) =>
      apiMutate<NonNullable<GmailConnection>>(
        `/workspaces/${workspaceId}/gmail-connection`,
        "POST",
        input,
      ),

    disconnectGmail: (workspaceId: string, eraseData: boolean) =>
      apiMutate<DisconnectResult>(
        `/workspaces/${workspaceId}/gmail-connection${eraseData ? "?eraseData=true" : ""}`,
        "DELETE"
      ),

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

    updateTaxonomyNode: (workspaceId: string, nodeId: string, input: UpdateTaxonomyNodeInput) =>
      apiMutate<TaxonomyNode>(
        `/workspaces/${workspaceId}/taxonomy-nodes/${nodeId}`,
        "PATCH",
        input
      ),

    deleteTaxonomyNode: (workspaceId: string, nodeId: string, moveToNodeId?: string) =>
      apiMutate<OkResult>(
        `/workspaces/${workspaceId}/taxonomy-nodes/${nodeId}`,
        "DELETE",
        moveToNodeId ? { moveToNodeId } : undefined
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
      apiMutate<OkResult>(
        `/workspaces/${workspaceId}/taxonomy-edges/${edgeId}`,
        "DELETE"
      ),

    // Atomically replaces the workspace's non-root taxonomy from a transfer file
    // (the root node is preserved server-side). Used by template-apply now and by
    // file import later.
    importTaxonomy: (workspaceId: string, file: TaxonomyTransferFile) =>
      apiMutate<{ ok: true }>(
        `/workspaces/${workspaceId}/taxonomy-import`,
        "POST",
        file
      ),

    folderCounts: (workspaceId: string) =>
      apiFetch<FolderCountsResult>(`/workspaces/${workspaceId}/folder-counts`),

    emailThreads: (
      workspaceId: string,
      filters?: { nodeId?: string; status?: string; cursor?: string }
    ) => {
      const params = new URLSearchParams();
      if (filters?.nodeId) params.set("nodeId", filters.nodeId);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.cursor) params.set("cursor", filters.cursor);
      const qs = params.toString();
      return apiFetch<EmailThreadListResult>(
        `/workspaces/${workspaceId}/email-threads${qs ? `?${qs}` : ""}`
      );
    },

    emailThread: (workspaceId: string, threadId: string) =>
      apiFetch<EmailThreadDetail>(
        `/workspaces/${workspaceId}/email-threads/${threadId}`
      ),

    threadBodies: (workspaceId: string, threadId: string) =>
      apiFetch<{ bodies: Record<string, string | null> }>(
        `/workspaces/${workspaceId}/email-threads/${threadId}/bodies`
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

    cancelClassify: (workspaceId: string, threadId: string) =>
      apiMutate<{ cancelled: boolean; jobRemoved: boolean }>(
        `/workspaces/${workspaceId}/email-threads/${threadId}/classify`,
        "DELETE"
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

    routeUnrouted: (workspaceId: string) =>
      apiMutate<{ queued: number }>(
        `/workspaces/${workspaceId}/sorting-queue/route-unrouted`,
        "POST"
      ),

    rerouteUnclassified: (workspaceId: string) =>
      apiMutate<{ queued: number }>(
        `/workspaces/${workspaceId}/sorting-queue/reroute-unclassified`,
        "POST"
      ),

    generateDraft: async (
      workspaceId: string,
      threadId: string,
      opts: { force?: boolean } = {}
    ): Promise<GenerateDraftResult> => {
      const path = `/workspaces/${workspaceId}/email-threads/${threadId}/generate-draft`;
      const res = await apiRequest(path, {
        method: "POST",
        cache: "no-store",
        headers: opts.force ? { "X-Force-Regenerate": "1" } : {},
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        return {
          quotaExceeded: true as const,
          used: typeof body["used"] === "number" ? body["used"] : 0,
          limit: typeof body["limit"] === "number" ? body["limit"] : 0,
          resetsAt: typeof body["resetsAt"] === "string" ? body["resetsAt"] : "",
        };
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `API returned ${res.status}`);
      }
      const data = await res.json() as { draft: Draft } | { generating: true };
      if ("draft" in data) {
        return { draft: data.draft, isNew: res.status === 201 };
      }
      return data;
    },

    draftQuota: (workspaceId: string) =>
      apiFetch<QuotaInfo>(`/workspaces/${workspaceId}/draft-quota`),

    threadSortQuota: (workspaceId: string) =>
      apiFetch<QuotaInfo>(`/workspaces/${workspaceId}/thread-sort-quota`),

    threadDrafts: (workspaceId: string, threadId: string) =>
      apiFetch<{ drafts: Draft[] }>(
        `/workspaces/${workspaceId}/email-threads/${threadId}/drafts`
      ),

    dismissDraft: (workspaceId: string, threadId: string, draftId: string) =>
      apiMutate<OkResult>(
        `/workspaces/${workspaceId}/email-threads/${threadId}/drafts/${draftId}`,
        "DELETE"
      ),

    toggleDraftSent: (
      workspaceId: string,
      threadId: string,
      draftId: string,
      sent: boolean
    ) =>
      apiMutate<{ draft: Draft }>(
        `/workspaces/${workspaceId}/email-threads/${threadId}/drafts/${draftId}`,
        "PATCH",
        { status: sent ? "SENT" : "PROPOSED" }
      ),

    // ── Push devices ─────────────────────────────────────────────────────────

    registerPushDevice: (input: RegisterPushDeviceInput) =>
      apiMutate<RegisterPushDeviceResult>("/devices", "POST", input),

    // ── Dev endpoints ──────────────────────────────────────────────────────────

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
      apiFetch<GmailRecentThreadsResult>(
        `/dev/workspaces/${workspaceId}/gmail-recent-threads`
      ),

    sortGmailThread: (workspaceId: string, gmailThreadId: string) =>
      apiMutate<GmailSortResult>(
        `/dev/workspaces/${workspaceId}/gmail-sort-thread`,
        "POST",
        { gmailThreadId }
      ),
  };
}

export type ApiClient = ReturnType<typeof makeApiClient>;
