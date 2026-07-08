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
 * Outlook: open the message inside the full OWA mailbox at
 * `/mail/inbox/id/<messageId>` — that keeps the folder list and back navigation,
 * so the user can return to their inbox. The stored Graph `webLink` points at a
 * standalone reading popout instead (`owa/?ItemID=...&viewmodel=ReadMessageItem`,
 * which strips the mailbox chrome), so we rebuild the mailbox URL from it: its
 * `ItemID` query param is the URL-encoded store id the `/id/` route needs, and
 * its host distinguishes personal (outlook.live.com) from work/school
 * (outlook.office.com) accounts. Falls back to the OWA inbox when no usable
 * webLink was captured.
 */
export function buildThreadUrl(thread: ThreadUrlInput): string {
  if (thread.provider === "OUTLOOK") {
    return buildOutlookThreadUrl(thread.webLink);
  }
  return `https://mail.google.com/mail/u/0/#all/${thread.providerThreadId}`;
}

// The two OWA app hosts. office365.com only appears as a webLink/redirect host;
// the mailbox app itself lives at office.com, so work/school links resolve there.
function outlookHost(webLink: string | null): "outlook.live.com" | "outlook.office.com" {
  return webLink?.includes("outlook.live.com") ? "outlook.live.com" : "outlook.office.com";
}

// Pull the still-encoded ItemID value straight out of the webLink query string so
// it drops into the `/id/` path segment without a decode/re-encode round trip.
function extractItemId(webLink: string): string | null {
  return /[?&]ItemID=([^&]+)/i.exec(webLink)?.[1] ?? null;
}

function buildOutlookThreadUrl(webLink: string | null): string {
  const host = outlookHost(webLink);
  const itemId = webLink ? extractItemId(webLink) : null;
  // No resolvable message id: land on the mailbox root (shows the inbox).
  if (!itemId) return `https://${host}/mail/`;
  return `https://${host}/mail/inbox/id/${itemId}`;
}
