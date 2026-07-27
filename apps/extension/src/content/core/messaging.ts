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

// ─── Reply draft ──────────────────────────────────────────────────────────────
//
// The "Amarnai Reply" button in the provider's native compose. Unlike the
// summary, which fires on every thread open, this only ever runs on an explicit
// click — so it may take its time and report real outcomes to the user.

export const GENERATE_DRAFT_MESSAGE = "amarnai:generateDraft" as const;

export type GenerateDraftRequest = {
  type: typeof GENERATE_DRAFT_MESSAGE;
  /** The mailbox address currently visible in the mail UI (multi-login safety). */
  accountEmail: string;
  /** The provider's own thread id (Gmail thread id / Outlook conversationId). */
  providerThreadId: string;
};

/**
 * Why the background could not produce a draft. Unlike the summary's reasons —
 * which all render nothing — these reach the user: they clicked a button and are
 * owed an answer. `injectionDisabled` is the one settled answer: the button
 * removes itself rather than retrying.
 */
export type GenerateDraftFailureReason =
  | "signedOut"
  | "noWorkspace"
  | "noThread"
  | "injectionDisabled"
  | "error";

export type GenerateDraftPayload =
  /** `body` is plain text; the content script converts it for the compose. */
  | { kind: "draft"; draftId: string; body: string }
  | { kind: "quota"; used: number; limit: number; resetsAt: string }
  /** The thread has not been sorted yet, so there is nothing to draft against. */
  | { kind: "notSorted" };

export type GenerateDraftResponse =
  | { ok: true; result: GenerateDraftPayload }
  | { ok: false; reason: GenerateDraftFailureReason };

export function isThreadSummaryRequest(msg: unknown): msg is ThreadSummaryRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m["type"] === THREAD_SUMMARY_MESSAGE &&
    typeof m["accountEmail"] === "string" &&
    typeof m["providerThreadId"] === "string"
  );
}

// ─── Open the panel ───────────────────────────────────────────────────────────
//
// Sent when the user clicks an injected control that needs an account: signing
// in happens in Amarnai's own panel, never inside the mail page. Fire-and-forget
// — the content script has nothing to do with the answer.

export const OPEN_PANEL_MESSAGE = "amarnai:openPanel" as const;

export type OpenPanelRequest = { type: typeof OPEN_PANEL_MESSAGE };

export function isOpenPanelRequest(msg: unknown): msg is OpenPanelRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>)["type"] === OPEN_PANEL_MESSAGE
  );
}

export function isGenerateDraftRequest(msg: unknown): msg is GenerateDraftRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m["type"] === GENERATE_DRAFT_MESSAGE &&
    typeof m["accountEmail"] === "string" &&
    typeof m["providerThreadId"] === "string"
  );
}
