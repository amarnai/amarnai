export type {
  MailProvider,
  MailProfile,
  MailChangeResult,
  MailThreadMeta,
  MailThreadPage,
  MailWatchResult,
  MailAttachmentContent,
} from "./types.js";
export {
  MailAuthError,
  MailCursorExpiredError,
  MailThreadParseError,
  MailThreadNotFoundError,
} from "./errors.js";
export { createMailProvider } from "./create-mail-provider.js";
export type {
  MailConnection,
} from "./create-mail-provider.js";
export type {
  MailFolderLabelDef,
  MailApplyThreadLabelsOptions,
} from "./types.js";
export { providerHasWritebackScope } from "./writeback-scope.js";
