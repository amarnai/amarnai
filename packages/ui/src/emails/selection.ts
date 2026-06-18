// Re-export shim. The canonical, platform-agnostic thread filtering/queue logic
// lives in @amarnai/core/emails so both the web app and the mobile app share it.
export {
  QUEUES,
  filterThreads,
  countForActive,
  folderUnreadCount,
  buildFolderCounts,
} from "@amarnai/core/emails";
