export type {
  FolderItem,
  QueueId,
  ActiveSelection,
  SegFilter,
  ThreadStatus,
  ThreadMessage,
  DoneMark,
  ThreadAssignment,
  MemberItem,
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
  queueCountsFromServer,
} from "./selection.js";

export { mapThreads, mapThreadDetail, mapFolders } from "./mapThreads.js";
export { mergeThreads } from "./mergeThreads.js";
export { appendThreads } from "./appendThreads.js";
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
