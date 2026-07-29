import type { ThreadItem } from "./types.js";
import {
  OWA_ORGANIZATION_MAILBOX_URL,
  OWA_PERSONAL_MAILBOX_URL,
  resolveOutlookAccountType,
  type OutlookAccountType,
} from "./outlookAccount.js";

// Minimal shape needed to build a provider deep link. Accepts a full ThreadItem
// or any object carrying the same three fields (e.g. an extension triage row).
export type ThreadUrlInput = Pick<ThreadItem, "provider" | "providerThreadId" | "webLink">;

/**
 * Build a web deep link that opens a thread in the provider's mail UI.
 *
 * `accountEmail` is the connected mailbox address; when provided, the link is
 * pinned to that account so the browser's default mail session (which may be a
 * different account) is never silently opened instead.
 *
 * Gmail: the providerThreadId doubles as the URL key — `#all/<threadId>` opens
 * the conversation (use `#all/`, not `#inbox/`: `#inbox/` 404s to an empty view
 * for archived threads) and supports a hash-only swap for in-place tab reuse.
 * Route by `authuser=<email>`, never `/u/<index>`: the numeric index depends on
 * Google sign-in order per profile and silently opens the wrong account. Google
 * redirects authuser=<email> to the right mailbox and preserves the hash, or
 * shows sign-in pre-filled with that address when it has no session. (This is
 * the approach Google's own Site Kit uses.) Without an accountEmail (e.g. the
 * marketing-site mock) we keep the legacy `/u/0/` form.
 *
 * Outlook: the conversationId is not URL-resolvable, and the message's OWA
 * mailbox URL (`/mail/inbox/id/<id>`) needs an id encoding we can't derive from
 * what we store — the `webLink`'s `ItemID` is an EWS store id in a different
 * format, and OWA rejects it (bouncing to `/mail/`). So we open Microsoft's own
 * `webLink` deep link, appending `&ispopout=0` so it opens in the OWA reading
 * pane (reusing the tab) rather than a separate popout window, plus
 * `login_hint=<email>` so a fresh sign-in is pre-filled with the connected
 * account. OWA cannot be forced to switch an existing wrong-account session via
 * URL; in that case the item id fails to resolve rather than showing another
 * mailbox's content. Falls back to the OWA inbox when no webLink was captured.
 *
 * `accountType` says whether the Outlook mailbox is a personal Microsoft account
 * or a work/school one; the two live on different OWA hosts (see
 * outlookAccount.ts). It only matters for the no-webLink fallback here, since a
 * `webLink` Microsoft issued is already on the right host. Callers that do not
 * have it get the address-based guess.
 */
export function buildThreadUrl(
  thread: ThreadUrlInput,
  accountEmail?: string | null,
  accountType?: OutlookAccountType | null,
): string {
  if (thread.provider === "OUTLOOK") {
    if (!thread.webLink) return buildMailboxUrl("OUTLOOK", accountEmail, accountType);
    const separator = thread.webLink.includes("?") ? "&" : "?";
    const url = `${thread.webLink}${separator}ispopout=0`;
    const hint = outlookLoginHint(accountEmail, accountType);
    return hint ? `${url}&login_hint=${hint}` : url;
  }
  const hint = accountEmail ? encodeURIComponent(accountEmail) : null;
  return hint
    ? `https://mail.google.com/mail/?authuser=${hint}#all/${thread.providerThreadId}`
    : `https://mail.google.com/mail/u/0/#all/${thread.providerThreadId}`;
}

/**
 * Build a link to the mailbox itself rather than to a thread, account-routed by
 * the same rules as buildThreadUrl (`authuser` for Gmail, `login_hint` for OWA)
 * so it cannot land on whichever account the browser happens to be signed into.
 *
 * Used when there is no thread to point at: the extension sending a user to the
 * inbox their panel is meant to sit beside, and the no-webLink Outlook fallback
 * above.
 *
 * The Outlook host is chosen from `accountType`: a personal Microsoft account
 * sent to the work/school host is refused outright with AADSTS500200, so there
 * is no host that works for both. See outlookAccount.ts.
 */
export function buildMailboxUrl(
  provider: ThreadUrlInput["provider"],
  accountEmail?: string | null,
  accountType?: OutlookAccountType | null,
): string {
  if (provider === "OUTLOOK") {
    if (resolveOutlookAccountType(accountType, accountEmail) === "PERSONAL") {
      return OWA_PERSONAL_MAILBOX_URL;
    }
    const hint = outlookLoginHint(accountEmail, accountType);
    return hint ? `${OWA_ORGANIZATION_MAILBOX_URL}?login_hint=${hint}` : OWA_ORGANIZATION_MAILBOX_URL;
  }
  const hint = accountEmail ? encodeURIComponent(accountEmail) : null;
  return hint
    ? `https://mail.google.com/mail/?authuser=${hint}#inbox`
    : "https://mail.google.com/mail/u/0/#inbox";
}

/**
 * The `login_hint` value for an OWA URL, or null when there is nothing to pin.
 *
 * Omitted for personal accounts: consumer OWA ignores `login_hint` entirely, so
 * appending it would only suggest an account guarantee we do not have there. A
 * personal mailbox opens on whichever consumer session the browser holds.
 */
function outlookLoginHint(
  accountEmail: string | null | undefined,
  accountType: OutlookAccountType | null | undefined,
): string | null {
  if (!accountEmail) return null;
  if (resolveOutlookAccountType(accountType, accountEmail) === "PERSONAL") return null;
  return encodeURIComponent(accountEmail);
}
