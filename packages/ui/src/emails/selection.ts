import type { FolderItem } from "../folder-tree/types.js";
import type { QueueId, ActiveSelection, SegFilter, ThreadItem } from "./types.js";

export const QUEUES: { id: QueueId; name: string; warn?: boolean; desc: string }[] = [
  { id: "all", name: "All", desc: "Every thread in your inbox." },
  { id: "sorted", name: "Sorted", desc: "Threads Amarnai has successfully routed to a folder." },
  {
    id: "review",
    name: "Needs review",
    warn: true,
    desc: "Threads flagged for review — Amarnai wasn't confident enough to sort automatically.",
  },
  { id: "pending", name: "Pending", desc: "Threads that haven't been sorted yet." },
  { id: "important", name: "Important", desc: "Threads Gmail has flagged as important." },
];

function baseFilter(
  threads: ThreadItem[],
  folders: FolderItem[],
  active: ActiveSelection,
): ThreadItem[] {
  if (active.kind === "folder") {
    const descendantIds = new Set([
      active.id,
      ...folders.filter((f) => f.parentId === active.id).map((f) => f.id),
    ]);
    return threads.filter((t) => t.folderId != null && descendantIds.has(t.folderId));
  }
  switch (active.id) {
    case "all": return threads;
    case "sorted": return threads.filter((t) => t.status === "sorted");
    case "review": return threads.filter((t) => t.status === "review");
    case "pending": return threads.filter((t) => t.status === "unsorted");
    case "important": return threads.filter((t) => t.isImportant);
    case "unrouted": return threads.filter((t) => t.status === "unrouted");
    case "unclassified": return threads.filter((t) => t.status === "unclassified");
  }
}

export function filterThreads(
  threads: ThreadItem[],
  folders: FolderItem[],
  active: ActiveSelection,
  seg: SegFilter,
  query: string,
): ThreadItem[] {
  let list = baseFilter(threads, folders, active);
  if (seg === "unread") list = list.filter((t) => t.unread);
  if (seg === "low") list = list.filter((t) => t.confidence < 0.8 || t.status === "review");
  const q = query.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        t.snippet.toLowerCase().includes(q) ||
        t.participants.toLowerCase().includes(q),
    );
  }
  return list;
}

export function countForActive(
  threads: ThreadItem[],
  folders: FolderItem[],
  active: ActiveSelection,
): number {
  return baseFilter(threads, folders, active).length;
}

export function folderUnreadCount(
  threads: ThreadItem[],
  folderId: string,
  childIds: Set<string>,
): number {
  return threads.filter(
    (t) => t.unread && t.folderId != null && childIds.has(t.folderId),
  ).length;
}

export function buildFolderCounts(
  threads: ThreadItem[],
  folders: FolderItem[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const folder of folders) {
    const allIds = new Set([
      folder.id,
      ...folders.filter((c) => c.parentId === folder.id).map((c) => c.id),
    ]);
    const unread = folderUnreadCount(threads, folder.id, allIds);
    if (unread > 0) counts.set(folder.id, unread);
  }
  return counts;
}
