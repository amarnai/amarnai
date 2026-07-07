/**
 * Provider-neutral control-flow errors for the mail seam.
 *
 * These are the canonical error types the pipeline catches (`instanceof
 * MailAuthError` / `MailCursorExpiredError`) so worker/API code never branches on
 * a provider-specific error name. For Phase A the concrete classes live in
 * `@amarnai/gmail` and are re-exported here under neutral names; a future
 * provider throws these same classes. When a second adapter lands, these move to
 * a dedicated contracts module so no adapter has to depend on Gmail for them.
 */
export {
  GmailAuthError as MailAuthError,
  GmailHistoryCursorExpiredError as MailCursorExpiredError,
  GmailThreadParseError as MailThreadParseError,
} from "@amarnai/gmail";
