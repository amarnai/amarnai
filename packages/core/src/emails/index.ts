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
export { mapMembers, type MemberRow } from "./mapMembers.js";
export { buildThreadUrl, type ThreadUrlInput } from "./threadUrl.js";
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

export {
  resolveInboxStatus,
  type InboxStatus,
  type InboxStatusInput,
  type WorkspacePlan,
} from "./inboxStatus.js";

export {
  FOLDER_COLOR_KEYS,
  defaultFolderColorKey,
  resolveFolderColorKey,
  folderColorVars,
  folderInkVar,
  type FolderColorKey,
  type FolderColorInput,
  type FolderColorVars,
} from "./folderColor.js";
