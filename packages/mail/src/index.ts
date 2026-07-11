export type {
  MailProvider,
  MailProfile,
  MailChangeResult,
  MailThreadMeta,
  MailThreadPage,
  MailWatchResult,
} from "./types.js";
export {
  MailAuthError,
  MailCursorExpiredError,
  MailThreadParseError,
  MailThreadNotFoundError,
} from "./errors.js";
export { createMailProvider } from "./create-mail-provider.js";
export type { MailConnection } from "./create-mail-provider.js";
