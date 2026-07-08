import type { ThreadItem } from "./types.js";

// Minimal shape needed to build a provider deep link. Accepts a full ThreadItem
// or any object carrying the same three fields (e.g. an extension triage row).
export type ThreadUrlInput = Pick<ThreadItem, "provider" | "providerThreadId" | "webLink">;

/**
 * Build a web deep link that opens a thread in the provider's mail UI.
 *
 * Gmail: the providerThreadId doubles as the URL key — `#all/<threadId>` opens
 * the conversation and supports a hash-only swap for in-place tab reuse.
 *
 * Outlook: the conversationId is not URL-resolvable, and the message's OWA
 * mailbox URL (`/mail/inbox/id/<id>`) needs an id encoding we can't derive from
 * what we store — the `webLink`'s `ItemID` is an EWS store id in a different
 * format, and OWA rejects it (bouncing to `/mail/`). So we open Microsoft's own
 * `webLink` deep link, appending `&ispopout=0` so it opens in the OWA reading
 * pane (reusing the tab) rather than a separate popout window. Falls back to the
 * OWA inbox when no webLink was captured.
 */
export function buildThreadUrl(thread: ThreadUrlInput): string {
  if (thread.provider === "OUTLOOK") {
    if (!thread.webLink) return "https://outlook.office.com/mail/";
    const separator = thread.webLink.includes("?") ? "&" : "?";
    return `${thread.webLink}${separator}ispopout=0`;
  }
  return `https://mail.google.com/mail/u/0/#all/${thread.providerThreadId}`;
}
