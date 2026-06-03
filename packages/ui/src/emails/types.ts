export type { FolderItem } from "../folder-tree/types.js";

export type QueueId = "all" | "sorted" | "review" | "pending" | "important";

export type ActiveSelection =
  | { kind: "queue"; id: QueueId }
  | { kind: "folder"; id: string };

export type SegFilter = "all" | "unread" | "low";

export type ThreadStatus = "sorted" | "review" | "unsorted";

export type ThreadMessage = {
  id: string;
  fromName: string;
  fromEmail: string;
  time: Date;
  snippet: string | null;
  bodyText: string | null;
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
  workspacePlan: "FREE" | "PRO" | "BUSINESS";
  pushEnabled: boolean;
} | null;
