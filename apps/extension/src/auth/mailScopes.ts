import { isWritebackAvailable } from "./writebackPolicy";

/**
 * The mail scopes the extension asks for, per provider, resolved against the
 * deployment's writeback policy. One module so the two provider flows cannot
 * drift on the policy or on the strings themselves.
 *
 * Every scope here is a deliberate literal rather than an import from
 * @aziru/gmail / @aziru/outlook, so the extension bundle does not pull the
 * provider clients in. Each set names the server-side constant it mirrors; those
 * are the source of truth and these must be changed in step with them.
 */

/** Mirrors GMAIL_READONLY_SCOPE plus the identity scopes the API's /me needs. */
const GOOGLE_READ_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

/** Mirrors GMAIL_MODIFY_SCOPE. Labels only: Aziru never sends or deletes. */
const GOOGLE_WRITE_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

/** Mirrors OUTLOOK_CONSENT_SCOPES. */
const MS_READ_SCOPES = "openid Mail.Read offline_access User.Read";

/**
 * Mirrors the write half of OUTLOOK_UPFRONT_CONSENT_SCOPES. Both are needed:
 * Mail.ReadWrite patches a message's categories, MailboxSettings.ReadWrite reads
 * and creates the mailbox's master category list. Added to the read set rather
 * than replacing it, because Microsoft refresh tokens are scope-bound and a
 * narrower grant must still be able to read.
 */
const MS_WRITE_SCOPES = "Mail.ReadWrite MailboxSettings.ReadWrite";

export type ResolvedScopes = {
  /** Space-delimited scope string for the authorize request. */
  scope: string;
  /** Whether the write scope is included, so callers can adjust their params. */
  writeScope: boolean;
};

export async function googleAuthScopes(): Promise<ResolvedScopes> {
  const writeScope = await isWritebackAvailable();
  return {
    scope: writeScope ? `${GOOGLE_READ_SCOPES} ${GOOGLE_WRITE_SCOPE}` : GOOGLE_READ_SCOPES,
    writeScope,
  };
}

export async function microsoftAuthScopes(): Promise<ResolvedScopes> {
  const writeScope = await isWritebackAvailable();
  return {
    scope: writeScope ? `${MS_READ_SCOPES} ${MS_WRITE_SCOPES}` : MS_READ_SCOPES,
    writeScope,
  };
}
