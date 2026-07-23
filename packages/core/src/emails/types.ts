export type FolderItem = {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  ignored: boolean;
  // Optional per-folder color override (a palette key). null/absent = use the
  // deterministic default. Resolved to a swatch via @amarnai/core folderColor.
  colorKey?: string | null;
};

export type QueueId = "all" | "sorted" | "review" | "pending" | "important" | "assigned" | "unrouted" | "unclassified";

export type ActiveSelection =
  | { kind: "queue"; id: QueueId }
  | { kind: "folder"; id: string };

export type SegFilter = "all" | "unread" | "low";

export type ThreadStatus = "sorted" | "review" | "unsorted" | "unrouted" | "unclassified";

export type ThreadMessage = {
  id: string;
  fromName: string;
  fromEmail: string;
  time: Date;
  snippet: string | null;
  bodyText: string | null;
  attachments?: Array<{ filename: string | null; mimeType: string }>;
  // CID inline images to render below the body. `url` is a ready-to-use image
  // source: a same-origin proxy URL on web, a blob: URL in the extension.
  inlineImages?: Array<{ url: string; filename: string | null }>;
};

export type DoneMark = {
  userId: string;
  userName: string | null;
  userEmail: string;
  resolvedAt: string;
};

export type ThreadAssignment = {
  userId: string;
  userName: string | null;
  userEmail: string;
  assignedAt: string;
};

// A workspace member as seen by the assignment UI. `userId` is the User id used
// as the assignee id in the API.
export type MemberItem = {
  userId: string;
  name: string | null;
  email: string;
};

export type ThreadItem = {
  id: string;
  subject: string;
  provider: "GMAIL" | "OUTLOOK";
  providerThreadId: string;
  // Representative message deep-link (Outlook); null for Gmail. Consumed by
  // buildThreadUrl to open/switch the thread in the provider's web UI.
  webLink: string | null;
  participants: string;
  latestAt: Date;
  messageCount: number;
  snippet: string;
  unread: boolean;
  folderId: string | null;
  status: ThreadStatus;
  confidence: number;
  reasoning: string | null;
  alternativeFolder: { folderId: string; name: string; weight: number } | null;
  messages: ThreadMessage[];
  hasDraft: boolean;
  isDrafting: boolean;
  lastSenderEmail: string | null;
  doneMark: DoneMark | null;
  assignment: ThreadAssignment | null;
  isImportant: boolean;
  isClassifying: boolean;
  attachmentCount: number;
};

export type DraftItem = {
  id: string;
  subject: string | null;
  body: string;
  status: "GENERATING" | "PROPOSED" | "SENT" | string;
};

export type SyncInfo = {
  lastSyncedAt: string | null;
  backfillStatus: "IDLE" | "RUNNING" | null;
  backfillLoadedThreads?: number;
  backfillTotalThreads?: number;
  backfillAwaitingTaxonomy?: boolean;
  workspacePlan: "FREE" | "PRO" | "BUSINESS";
  pushEnabled: boolean;
} | null;
