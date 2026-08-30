// Re-export shim. The canonical, platform-agnostic email view-model types live
// in @aziru/core/emails so both the web app and the mobile app share them.
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
} from "@aziru/core/emails";
