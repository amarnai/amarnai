// Re-exported so the panel's own modules name one type each, rather than each
// reaching into @amarnai/api-client and @amarnai/ui for pieces of the same
// thread. Nothing new is defined here on purpose: the panel renders exactly what
// the API returns, and a parallel view-model would be one more thing to keep in
// step with the web app.
export type {
  EmailThreadDetail,
  Draft,
  MailAccount,
  QuotaInfo,
  PanelQueueResult,
  PanelQueueSection,
  PanelQueueThread,
  SyncStatus,
} from "@amarnai/api-client";
export type { MemberItem, FolderItem } from "@amarnai/ui/emails";
