export { GraphClient } from "./graph-client.js";
export { normalizeGraphThread } from "./normalize-graph-thread.js";
export type { GraphMessage } from "./normalize-graph-thread.js";
export {
  OUTLOOK_SCOPES,
  OUTLOOK_MAIL_READ_SCOPE,
  OUTLOOK_MAIL_READWRITE_SCOPE,
  OUTLOOK_MAILBOX_SETTINGS_RW_SCOPE,
  OUTLOOK_WRITEBACK_SCOPES,
  OUTLOOK_SIGNIN_SCOPE,
  OUTLOOK_CONSENT_SCOPES,
  OUTLOOK_WRITEBACK_CONSENT_SCOPES,
  OUTLOOK_UPFRONT_SCOPES,
  OUTLOOK_UPFRONT_CONSENT_SCOPES,
  MICROSOFT_CONSUMER_TENANT_ID,
  MicrosoftApiError,
  parseGrantedScopes,
  hasWritebackScope,
  accountTypeFromIdToken,
  scopeForCodeRedemption,
  exchangeAuthCode,
  fetchOutlookProfile,
} from "./microsoft-oauth.js";
export type { OutlookTokens, OutlookProfile, OutlookAccountType } from "./microsoft-oauth.js";
