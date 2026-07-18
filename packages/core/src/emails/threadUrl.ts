import type { ThreadItem } from "./types.js";

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
 */
export function buildThreadUrl(thread: ThreadUrlInput, accountEmail?: string | null): string {
  const hint = accountEmail ? encodeURIComponent(accountEmail) : null;
  if (thread.provider === "OUTLOOK") {
    if (!thread.webLink) {
      return hint
        ? `https://outlook.office.com/mail/?login_hint=${hint}`
        : "https://outlook.office.com/mail/";
    }
    const separator = thread.webLink.includes("?") ? "&" : "?";
    const url = `${thread.webLink}${separator}ispopout=0`;
    return hint ? `${url}&login_hint=${hint}` : url;
  }
  return hint
    ? `https://mail.google.com/mail/?authuser=${hint}#all/${thread.providerThreadId}`
    : `https://mail.google.com/mail/u/0/#all/${thread.providerThreadId}`;
}
