export { GraphClient } from "./graph-client.js";
export { normalizeGraphThread } from "./normalize-graph-thread.js";
export type { GraphMessage } from "./normalize-graph-thread.js";
export {
  OUTLOOK_SCOPES,
  OUTLOOK_MAIL_READ_SCOPE,
  OUTLOOK_MAIL_READWRITE_SCOPE,
  OUTLOOK_WRITEBACK_SCOPES,
  MicrosoftApiError,
  parseGrantedScopes,
  hasWritebackScope,
  exchangeAuthCode,
  fetchOutlookProfile,
  fetchSubjectId,
} from "./microsoft-oauth.js";
export type { OutlookTokens, OutlookProfile } from "./microsoft-oauth.js";
