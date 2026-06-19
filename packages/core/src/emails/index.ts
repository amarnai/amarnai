export type {
  FolderItem,
  QueueId,
  ActiveSelection,
  SegFilter,
  ThreadStatus,
  ThreadMessage,
  DoneMark,
  ThreadItem,
  DraftItem,
  SyncInfo,
} from "./types.js";

export {
  QUEUES,
  filterThreads,
  countForActive,
  folderUnreadCount,
  buildFolderCounts,
} from "./selection.js";

export { mapThreads, mapFolders } from "./mapThreads.js";
export { mergeThreads } from "./mergeThreads.js";
export {
  useEmailTriage,
  type UseEmailTriageOptions,
  type Toast,
  type RerouteTarget,
} from "./useEmailTriage.js";

export {
  groupThreadsByDate,
  type DateSection,
} from "./groupThreadsByDate.js";
