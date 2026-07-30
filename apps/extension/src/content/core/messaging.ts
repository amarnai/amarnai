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
  /**
   * The mailbox address currently visible in the mail UI (multi-login safety).
   *
   * Null only where the page names no mailbox anywhere — OWA's standalone deeplink
   * read view has neither an account header nor a folder tree. The background then
   * falls back to the single connected mailbox (resolveMailboxAccount), and
   * declines when several are connected, so multi-login safety is unchanged
   * wherever an address does exist.
   */
  accountEmail: string | null;
  /** The provider's own thread id (Gmail thread id / Outlook conversationId). */
  providerThreadId: string;
  /**
   * What kind of id the above is — absent means a conversation id. "message" is
   * the deeplink read view, whose only id is the open message's.
   */
  refKind?: "thread" | "message";
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
  | { kind: "quota"; used: number; limit: number; resetsAt: string };

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

// ─── Open a conversation in the mail tab ──────────────────────────────────────
//
// Sent by the injected panel when the user picks a thread from its queue. The
// panel is an extension document embedded in the mail page, so it asks the
// background to navigate the tab it sits in — the same chrome.tabs.update path
// Amarnai's own side panel has always used to open a thread.
//
// It does NOT go through the mail page: a content script can only assign
// `location`, which is a write into a third-party SPA with no way to tell
// whether it took, and it needs the panel's postMessage channel to have survived
// whatever layout the page is in. Neither is true of a tab navigation.
//
// Fire-and-forget: the panel has already switched to the thread's screen by the
// time this is sent, and the page catches up on its own.

export const OPEN_MAIL_THREAD_MESSAGE = "amarnai:openMailThread" as const;

export type OpenMailThreadRequest = {
  type: typeof OPEN_MAIL_THREAD_MESSAGE;
  /** The provider's own thread id. Lands in the tab's URL, hence the bound. */
  providerThreadId: string;
};

/** Bounded because the id lands in a URL; real Gmail thread ids are far shorter. */
const MAX_PROVIDER_THREAD_ID_LEN = 256;

export function isOpenMailThreadRequest(msg: unknown): msg is OpenMailThreadRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m["type"] !== OPEN_MAIL_THREAD_MESSAGE) return false;
  const id = m["providerThreadId"];
  return typeof id === "string" && id.length > 0 && id.length <= MAX_PROVIDER_THREAD_ID_LEN;
}

export function isGenerateDraftRequest(msg: unknown): msg is GenerateDraftRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m["type"] !== GENERATE_DRAFT_MESSAGE) return false;
  if (typeof m["providerThreadId"] !== "string") return false;
  // Null is a value here, not a missing field: a page that names no mailbox says
  // so. `undefined` still fails, so a malformed message is still refused.
  const email = m["accountEmail"];
  if (email !== null && typeof email !== "string") return false;
  const refKind = m["refKind"];
  return refKind === undefined || refKind === "thread" || refKind === "message";
}
