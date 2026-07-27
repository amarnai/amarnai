// Typed protocol between the mail-page content scripts and the background script.
//
// The content script never talks to the API directly. Two reasons:
//   1. A fetch from a content script carries the page's origin (mail.google.com),
//      so the API would need a CORS hole for every mail host.
//   2. The bearer transport's refresh single-flight lives in the background; a
//      second copy in each tab would race it and burn refresh tokens.
//
// So the content script sends one message and renders whatever comes back. It
// sends only identifiers — an account address and a provider thread id. No page
// content ever leaves the page.

export const THREAD_SUMMARY_MESSAGE = "amarnai:threadSummary" as const;

export type ThreadSummaryRequest = {
  type: typeof THREAD_SUMMARY_MESSAGE;
  /** The mailbox address currently visible in the mail UI (multi-login safety). */
  accountEmail: string;
  /** The provider's own thread id (Gmail thread id / Outlook conversationId). */
  providerThreadId: string;
  force?: boolean;
};

/**
 * Why the background could not answer. The content script renders nothing for
 * every one of these — a mail page must never sprout an Amarnai error.
 *
 * "injectionDisabled" is the only one that is a settled answer rather than a
 * transient miss: the workspace has turned the card off, so the content script
 * stops asking for the life of the page instead of retrying every thread open.
 */
export type ThreadSummaryFailureReason =
  | "signedOut"
  | "noWorkspace"
  | "noThread"
  | "injectionDisabled"
  | "error";

export type ThreadSummaryPayload =
  | { kind: "summary"; text: string }
  | { kind: "bullets"; bullets: string[] }
  | { kind: "snippet" }
  | { kind: "quota"; used: number; limit: number; resetsAt: string };

export type ThreadSummaryResponse =
  | { ok: true; result: ThreadSummaryPayload }
  | { ok: false; reason: ThreadSummaryFailureReason };

export function isThreadSummaryRequest(msg: unknown): msg is ThreadSummaryRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m["type"] === THREAD_SUMMARY_MESSAGE &&
    typeof m["accountEmail"] === "string" &&
    typeof m["providerThreadId"] === "string"
  );
}
