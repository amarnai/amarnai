// One shared filter — used by QueueList (counts) and ThreadList (display). Do not duplicate.

export const QUEUES = [
  {
    id: "all" as const,
    name: "All",
    desc: "Every thread in your inbox.",
  },
  {
    id: "sorted" as const,
    name: "Sorted",
    desc: "Threads Amarnai has successfully routed to a folder.",
  },
  {
    id: "review" as const,
    name: "Needs review",
    warn: true,
    desc: "Threads flagged for review — Amarnai wasn't confident enough to sort automatically.",
  },
  {
    id: "pending" as const,
    name: "Pending",
    desc: "Threads that haven't been sorted yet.",
  },
];

export type QueueId = (typeof QUEUES)[number]["id"];

export type ActiveSelection =
  | { kind: "queue"; id: QueueId }
  | { kind: "folder"; id: string };

export type SegFilter = "all" | "unread" | "low";

export type ThreadStatus = "sorted" | "review" | "unsorted";

export type FolderItem = {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  ignored: boolean;
};

export type ThreadMessage = {
  id: string;
  fromName: string;
  fromEmail: string;
  time: Date;
  snippet: string | null;
  bodyText: string | null;
};

export type SuggestedDraft = {
  eyebrow: string;
  title: string;
  desc: string;
};

export type ThreadItem = {
  id: string;
  subject: string;
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
  suggestedDraft?: SuggestedDraft;
  messages: ThreadMessage[];
};

// ─── Shared filter ─────────────────────────────────────────────────────────────

function baseFilter(
  threads: ThreadItem[],
  folders: FolderItem[],
  active: ActiveSelection,
  _now: Date
): ThreadItem[] {
  if (active.kind === "folder") {
    const descendantIds = new Set([
      active.id,
      ...folders.filter((f) => f.parentId === active.id).map((f) => f.id),
    ]);
    return threads.filter(
      (t) => t.folderId != null && descendantIds.has(t.folderId)
    );
  }

  switch (active.id) {
    case "all":
      return threads;
    case "sorted":
      return threads.filter((t) => t.status === "sorted");
    case "review":
      return threads.filter((t) => t.status === "review");
    case "pending":
      return threads.filter((t) => t.status === "unsorted");
  }
}

export function filterThreads(
  threads: ThreadItem[],
  folders: FolderItem[],
  active: ActiveSelection,
  seg: SegFilter,
  query: string,
  now: Date
): ThreadItem[] {
  let list = baseFilter(threads, folders, active, now);

  if (seg === "unread") list = list.filter((t) => t.unread);
  if (seg === "low")
    list = list.filter((t) => t.confidence < 0.8 || t.status === "review");

  const q = query.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        t.snippet.toLowerCase().includes(q) ||
        t.participants.toLowerCase().includes(q)
    );
  }

  return list;
}

export function countForActive(
  threads: ThreadItem[],
  folders: FolderItem[],
  active: ActiveSelection,
  now: Date
): number {
  return baseFilter(threads, folders, active, now).length;
}

export function folderUnreadCount(
  threads: ThreadItem[],
  folderId: string,
  childIds: Set<string>
): number {
  return threads.filter(
    (t) => t.unread && t.folderId != null && childIds.has(t.folderId)
  ).length;
}
