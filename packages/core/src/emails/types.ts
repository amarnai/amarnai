export type FolderItem = {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  ignored: boolean;
};

export type QueueId = "all" | "sorted" | "review" | "pending" | "important" | "unrouted" | "unclassified";

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
};

export type DoneMark = {
  userId: string;
  userName: string | null;
  userEmail: string;
  resolvedAt: string;
};

export type ThreadItem = {
  id: string;
  subject: string;
  providerThreadId: string;
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
  backfillSortedThreads?: number;
  backfillTotalThreads?: number;
  backfillAwaitingTaxonomy?: boolean;
  workspacePlan: "FREE" | "PRO" | "BUSINESS";
  pushEnabled: boolean;
} | null;
