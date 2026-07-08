// Re-export shared types consumed unchanged by the API.
export type {
  TaxonomyEdge,
  GmailSyncSettings,
  UpdateGmailSyncSettingsInput,
  GenerationEligibility,
  GenerationEligibilityReason,
} from "@amarnai/shared";

import type { GenerationEligibility } from "@amarnai/shared";
import type { TaxonomyTransferFile } from "@amarnai/shared";

export type OkResult = { ok: boolean };

// Mail provider discriminant, mirroring the Prisma `Provider` enum. Drives
// provider-aware deep links and connection UI.
export type MailProvider = "GMAIL" | "OUTLOOK";

// GET /workspaces/:id/taxonomy-generate — current generation status, the cost
// limiter verdict, and the latest READY proposal (for preview before apply).
export type TaxonomyGenerationStatus =
  | "IDLE"
  | "RUNNING"
  | "READY"
  | "INSUFFICIENT"
  | "FAILED";

export type TaxonomyGenerationStatusResult = {
  status: TaxonomyGenerationStatus;
  eligibility: GenerationEligibility;
  /** True while the historical backfill is still ingesting the inbox. */
  importing: boolean;
  matchedTemplateId: string | null;
  lastOutcome: string | null;
  proposal: TaxonomyTransferFile | null;
};

// Deterministic best-fit template for the picker's "Recommended" badge. Null
// when no inbox is connected or the inbox has too little signal to match.
export type TaxonomyTemplateRecommendationResult = {
  recommendedTemplateId: string | null;
};

export type QuotaInfo = { used: number; limit: number; resetsAt: string };

// Authenticated identity for the current access token (GET /auth/me). Native
// clients use emailVerified to gate app access after sign-up.
export type CurrentUser = {
  userId: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  // Whether the user receives weekly inbox-reminder lifecycle emails.
  lifecycleEmailsEnabled: boolean;
  // True when the account has a password set (vs. federated Google-only). Used
  // to decide whether to prompt for a password on sensitive actions.
  hasPassword: boolean;
  // UI display language (BCP 47 tag, e.g. "en", "fr", "pt-BR").
  locale: string;
};

// Partial profile/preferences update for PATCH /auth/me. Only the provided
// fields are changed server-side.
export type UpdateCurrentUserInput = {
  name?: string;
  lifecycleEmailsEnabled?: boolean;
  locale?: string;
};

// Body-only inputs; workspaceId is carried in the URL path (differs from shared).
export type CreateTaxonomyEdgeInput = {
  sourceNodeId: string;
  targetNodeId: string;
};

export type UpdateTaxonomyEdgeInput = { newSourceNodeId?: string };

// Partial of CreateTaxonomyNodeInput preserving null on nullable fields
// (differs from @amarnai/shared's UpdateTaxonomyNodeInput which strips null).
export type UpdateTaxonomyNodeInput = Partial<CreateTaxonomyNodeInput>;

// ── Workspace ─────────────────────────────────────────────────────────────────

export type Workspace = {
  id: string;
  name: string;
  // Workspace language (UI + AI-generated taxonomy), an i18n SupportedLocale code.
  locale: string;
  plan: "FREE" | "PRO" | "BUSINESS";
  createdAt: string;
  updatedAt: string;
  owner: { id: string; email: string; name: string | null };
  members: Array<{
    id: string;
    role: string;
    user: { id: string; email: string; name: string | null };
  }>;
};

// ── Taxonomy ──────────────────────────────────────────────────────────────────

// API response extends the shared schema with the computed threadCount.
export type TaxonomyNode = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  instructions: string | null;
  draftPrompt: string | null;
  examples: string[];
  isRoot: boolean;
  /** The non-routable catch-all destination ("Updates / Other"). Exactly one per
   * workspace; cannot be deleted or have its flag changed. */
  isCatchAll: boolean;
  positionX: number;
  positionY: number;
  createdAt: string;
  updatedAt: string;
  threadCount: number;
};

// Body-only input; workspaceId is carried in the URL path.
export type CreateTaxonomyNodeInput = {
  name: string;
  description?: string;
  instructions?: string | null;
  draftPrompt?: string | null;
  examples?: string[];
  positionX?: number;
  positionY?: number;
};

// ── Email threads ─────────────────────────────────────────────────────────────

export type TriageStatus =
  | "PENDING"
  | "SORTED"
  | "NEEDS_REVIEW"
  | "UNROUTED"
  | "UNCLASSIFIED"
  | "QUOTA_BLOCKED";

export type DoneMark = {
  userId: string;
  userName: string | null;
  userEmail: string;
  resolvedAt: string;
};

// Thread assignment (ownership). Same person shape as DoneMark but a distinct
// concept: who should handle the thread, independent of who marked it done.
export type ThreadAssignment = {
  userId: string;
  userName: string | null;
  userEmail: string;
  assignedAt: string;
};

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

export type FilterCounts = {
  total: number;
  PENDING: number;
  // Subset of PENDING that are not yet enqueued (classifyingAt = null).
  // Drives the "Route now" banner; excludes threads already being sorted.
  PENDING_WAITING: number;
  NEEDS_REVIEW: number;
  SORTED: number;
  UNROUTED: number;
  UNCLASSIFIED: number;
  // Count of user-marked important threads (orthogonal to triageStatus).
  important: number;
  // Count of threads assigned to the current user (orthogonal to triageStatus).
  assigned: number;
};

export type EmailThreadSummary = {
  id: string;
  subject: string | null;
  provider: MailProvider;
  providerThreadId: string;
  // Representative message deep-link for providers whose thread id is not itself
  // URL-resolvable (Outlook). Null for Gmail (providerThreadId is the link key).
  webLink: string | null;
  latestMessageAt: string | null;
  messageCount: number;
  triageStatus: TriageStatus;
  isClassifying: boolean;
  isQueued: boolean;
  createdAt: string;
  isImportant: boolean;
  messages: Array<{
    id: string;
    senderEmail: string;
    senderName: string | null;
    snippet: string | null;
    receivedAt: string;
    hasAttachments: boolean;
    attachments: Array<{ filename: string | null; mimeType: string }>;
  }>;
  tags: EmailTag[];
  latestClassification: ClassificationSummary | null;
  hasDraft: boolean;
  isDrafting: boolean;
  doneMark: DoneMark | null;
  assignment: ThreadAssignment | null;
};

export type EmailThreadListResult = {
  threads: EmailThreadSummary[];
  nextCursor: string | null;
  counts: FilterCounts;
  // Count of threads matching the active view (queue/folder) + search, ignoring
  // the page cursor. Drives the "X threads" label.
  filteredTotal: number;
};

export type EmailThreadDetail = {
  id: string;
  subject: string | null;
  provider: MailProvider;
  providerThreadId: string;
  webLink: string | null;
  latestMessageAt: string | null;
  messageCount: number;
  triageStatus: TriageStatus;
  isClassifying: boolean;
  isQueued: boolean;
  createdAt: string;
  updatedAt: string;
  isImportant: boolean;
  hasDraft: boolean;
  isDrafting: boolean;
  messages: Array<{
    id: string;
    senderEmail: string;
    senderName: string | null;
    subject: string | null;
    snippet: string | null;
    bodyText: string | null;
    receivedAt: string;
    hasAttachments: boolean;
    attachments: Array<{ filename: string | null; mimeType: string }>;
    toEmails: unknown;
  }>;
  latestClassification: Classification | null;
  tags: EmailTag[];
  doneMark: DoneMark | null;
  assignment: ThreadAssignment | null;
};

// ── Notifications ──────────────────────────────────────────────────────────────

// Generic in-app notification. `type` + `params` are producer-defined; the
// client maps them to localized display text at render time.
export type NotificationItem = {
  id: string;
  workspaceId: string;
  type: string;
  params: Record<string, unknown>;
  readAt: string | null;
  // Set once the recipient has dealt with the notification (clicked through or
  // dismissed). Dismissed rows are hidden from the bell pop-up but still listed
  // on the full notifications page. Independent of readAt.
  dismissedAt: string | null;
  createdAt: string;
};

export type NotificationListResult = {
  notifications: NotificationItem[];
  nextCursor: string | null;
};

export type UnreadCountResult = { count: number };

// ── Gmail ─────────────────────────────────────────────────────────────────────

export type ConnectGmailInput = {
  serverAuthCode: string;
  scope: string;
  // Set by the browser extension: the chromiumapp.org redirect its code was
  // minted for. Omitted by mobile (server-auth code redeemed with no redirect).
  redirectUri?: string;
};

// Outlook connect input. Unlike Gmail, the code is always redeemed against a
// redirect (the browser extension's chromiumapp.org URL), so `redirectUri` is
// required.
export type ConnectOutlookInput = {
  code: string;
  scope: string;
  redirectUri: string;
};

export type GmailConnection = {
  id: string;
  workspaceId: string;
  provider: MailProvider;
  // The connected mailbox address, whatever the provider. Field name kept for
  // backwards compatibility; it holds the Outlook address for Outlook connections.
  gmailAddress: string;
  grantedScopes: string[];
  status: "ACTIVE" | "DISCONNECTED";
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sharedMailbox: boolean;
  alsoConnectedIn: { id: string; name: string }[];
} | null;

export type DisconnectResult = {
  ok: true;
  erased: boolean;
  revoked: boolean;
  watchStopped: boolean;
  jobsRemoved: number;
  sharedMailbox: boolean;
};

export type BackfillStatus = "PENDING" | "RUNNING" | "DONE" | "ERROR";

// Which import-limit state the last backfill ended in — selects the plan-cap banner
// message. NONE = no banner; CAPPED = initial import hit the plan cap (more email
// remains, retry still available); CAPPED_RETRY = the grace re-import hit the cap
// (monthly retry now used); BLOCKED = base + grace both spent (no import until roll).
export type BackfillLimitState = "NONE" | "CAPPED" | "CAPPED_RETRY" | "BLOCKED";

export type SyncStatus = {
  status: "IDLE" | "SYNCING" | "ERROR";
  lastSyncedAt: string | null;
  errorMessage: string | null;
  backfillStatus: BackfillStatus;
  backfillSkipped: number;
  backfillCompletedAt: string | null;
  // True when the backfill stopped at the plan's thread cap with more threads
  // still in Gmail; backfillBeyondCount is the approximate number left behind.
  backfillCapReached: boolean;
  backfillBeyondCount: number;
  // Which limit state the banner should reflect (see BackfillLimitState).
  backfillLimitState: BackfillLimitState;
  // Backfill loading progress (only meaningful while backfillStatus is RUNNING):
  // past threads fetched from Gmail so far vs. the estimated total to fetch, plus
  // whether the taxonomy is currently too small to route any of them.
  backfillLoadedThreads: number;
  backfillTotalThreads: number;
  backfillAwaitingTaxonomy: boolean;
  // Whether the user has started backfill routing. Until then the import runs but
  // nothing is classified; clients surface the "Start sorting" action.
  backfillRoutingStarted: boolean;
  sortingPaused: boolean;
  workspacePlan: "FREE" | "PRO" | "BUSINESS";
  pushEnabled: boolean;
} | null;

export type FolderCountsResult = {
  counts: { nodeId: string; count: number }[];
  total: number;
};

// ── Taxonomy import (migration) ─────────────────────────────────────────────────

/** One incoming-folder candidate for an outgoing folder, with its similarity. */
export type MigrationCandidate = { ref: string; sim: number };

/** One outgoing folder's migration suggestion, enriched for the review UI. */
export type MigrationPreviewRow = {
  oldNodeId: string;
  oldName: string;
  isCatchAll: boolean;
  threadCount: number;
  /** Suggested incoming folder ref, or null to re-sort with AI. */
  suggestedRef: string | null;
  matchKind: "catch_all" | "name" | "embedding" | null;
  candidates: MigrationCandidate[];
};

export type TaxonomyImportPreviewResult = {
  suggestions: MigrationPreviewRow[];
  /** Threads carried over instantly (auto-mapped folders), no AI cost. */
  migrateCount: number;
  /** Threads that will be re-sorted by AI. */
  resortCount: number;
};

export type TaxonomyImportResult = {
  ok: true;
  nodeCount: number;
  edgeCount: number;
  migratedThreads: number;
  requeuedThreads: number;
};

/** Old node DB id → new folder ref, or the "resort" sentinel. */
export type TaxonomyMigrationMapping = Record<string, string>;

// ── Drafts ────────────────────────────────────────────────────────────────────

export type Draft = {
  id: string;
  subject: string | null;
  body: string;
  status: "GENERATING" | "PROPOSED" | "SENT";
  createdAt: string;
};

export type GenerateDraftResult =
  | { draft: Draft; isNew: boolean }
  | { generating: true }
  | ({ quotaExceeded: true } & QuotaInfo);

// ── Dev / debug endpoints ─────────────────────────────────────────────────────

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

export type QueuedResult = { queued: true };

// ── Push devices ──────────────────────────────────────────────────────────────

export type DevicePlatform = "ANDROID" | "IOS";

export type RegisterPushDeviceInput = {
  expoPushToken: string;
  platform: DevicePlatform;
};

export type RegisterPushDeviceResult = { ok: boolean; deviceId: string };

// ── Browser extension ───────────────────────────────────────────────────────────

export type ExtensionBrowser = "CHROME" | "FIREFOX";

export type RegisterExtensionInput = {
  browser: ExtensionBrowser;
  version: string;
};

export type RegisterExtensionResult = { ok: boolean };
