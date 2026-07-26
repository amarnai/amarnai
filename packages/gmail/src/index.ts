export { encrypt, decrypt } from "./encryption.js";
export {
  GmailClient,
  GmailAuthError,
  GmailHistoryCursorExpiredError,
  GmailThreadParseError,
  GmailThreadNotFoundError,
  revokeGoogleToken,
} from "./gmail-client.js";
export type { GmailProfile, GmailHistoryResult, GmailThreadMeta, GmailWatchResult } from "./gmail-client.js";
export { normalizeGmailThread } from "./gmail-thread-adapter.js";
export type { RawGmailThread } from "./gmail-thread-adapter.js";
export {
  GMAIL_READONLY_SCOPE,
  GMAIL_MODIFY_SCOPE,
  GmailApiError,
  exchangeAuthCode,
  exchangeServerAuthCode,
  parseGrantedScopes,
  hasWritebackScope,
  fetchGmailProfile,
  fetchGoogleSubjectId,
  fetchGoogleUserInfo,
} from "./google-oauth.js";
export type { GmailTokens, GoogleUserInfo } from "./google-oauth.js";
