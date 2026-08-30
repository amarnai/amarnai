// Re-exported so the panel's own modules name one type each, rather than each
// reaching into @aziru/api-client and @aziru/ui for pieces of the same
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
} from "@aziru/api-client";
export type { MemberItem, FolderItem } from "@aziru/ui/emails";
