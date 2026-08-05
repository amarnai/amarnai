// The postMessage protocol between the mail page's content script and the panel
// iframe it hosts.
//
// The iframe is extension-origin and the page around it is not, so this crosses
// an origin boundary in both directions and every frame has to be treated as
// hostile until proven otherwise. Two defences, always both:
//
//   1. Origin. The content script accepts only messages whose source is the
//      iframe it created; the iframe accepts only messages from the mail host it
//      was embedded in. Neither side trusts `event.data` to say who it is.
//   2. Shape. A guard per message type, in the messaging.ts style. Anything that
//      does not match is dropped silently — a mail page must never sprout an
//      Amarnai error because some other script on it posted something.
//
// `v` versions the protocol so an extension update that reloads the content
// script while an old iframe is still alive cannot half-understand it.
//
// v2: the thread context carries the mailbox even when no conversation is open
// (providerThreadId became nullable). The bump is what makes the change safe
// rather than merely additive: a
// v1 iframe's guard requires providerThreadId to be a string, so it would drop
// a "no conversation open" context silently and keep rendering the thread the
// user had already left. Mismatched halves now understand nothing of each
// other, which degrades to the handshake timeout instead.

export const PANEL_PROTOCOL_VERSION = 2;

/**
 * Query parameter on the iframe's src, naming which embedder loaded it.
 *
 * Part of the contract rather than either half's private business: the content
 * script writes it and the frame reads it, and it lives here so neither has to
 * import the other's module to agree on the spelling. Not a trust boundary —
 * see the frame's own note — it only decides which affordances the panel offers,
 * which has to be known before any message has been exchanged.
 */
export const PANEL_EMBED_PARAM = "embed";

// ── Host → iframe ─────────────────────────────────────────────────────────────

export const PANEL_THREAD_CONTEXT = "amarnai:panel:threadContext" as const;
export const PANEL_VISIBILITY = "amarnai:panel:visibility" as const;
export const PANEL_INSERT_RESULT = "amarnai:panel:insertResult" as const;
/**
 * The user clicked an in-page comments control (the bubble on the injected
 * summary card): expand the panel's Comments section and scroll it into view.
 * An event, not state — deliberately not replayed by the handshake, because a
 * reloaded frame should not spontaneously re-focus comments.
 *
 * Additive without a version bump, like PANEL_DISABLED but in the other
 * direction: an old frame drops the unknown type through its guards and the
 * click simply reveals the panel, and an old host never sends it.
 */
export const PANEL_FOCUS_COMMENTS = "amarnai:panel:focusComments" as const;

export type PanelThreadContextMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_THREAD_CONTEXT;
  /**
   * Null only when the host could not read the page at all. A null
   * `providerThreadId` with an address means the mailbox is known and no
   * conversation is open — the panel needs the address there too, because that
   * is what maps the page to a workspace and lets it show the queue.
   *
   * A null `accountEmail` is the mirror case: a page the host read that names no
   * mailbox anywhere (OWA's standalone deeplink read view has no account header
   * and no folder tree). The panel resolves that against the connected mailboxes
   * rather than the host guessing here.
   */
  context: {
    providerThreadId: string | null;
    accountEmail: string | null;
    /**
     * What kind of id `providerThreadId` is — absent means a conversation id.
     * "message" is the deeplink read view, whose only id is the open message's.
     */
    refKind?: "thread" | "message";
  } | null;
};

export type PanelVisibilityMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_VISIBILITY;
  visible: boolean;
};

export type PanelInsertResultMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_INSERT_RESULT;
  requestId: string;
  ok: boolean;
};

export type PanelFocusCommentsMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_FOCUS_COMMENTS;
};

export type HostToPanelMessage =
  | PanelThreadContextMessage
  | PanelVisibilityMessage
  | PanelInsertResultMessage
  | PanelFocusCommentsMessage;

// ── Iframe → host ─────────────────────────────────────────────────────────────

// Only what the page itself must do. Opening a conversation is deliberately NOT
// here: the panel is an extension document and asks the background to navigate
// its tab (see content/core/messaging.ts), which needs neither this channel nor
// a write into Gmail's own location.
export const PANEL_READY = "amarnai:panel:ready" as const;
export const PANEL_INSERT_DRAFT = "amarnai:panel:insertDraft" as const;
export const PANEL_OPEN_PANEL = "amarnai:panel:openPanel" as const;
/**
 * The workspace has switched the injected panel off, as the API just told the
 * frame. The host removes itself: the kill switch has to un-inject, not merely
 * blank what is injected, or a workspace that turned the panel off still has
 * Amarnai chrome on every mail page (OWA's drawer tab above Fluent's dialog
 * layer, an entry in Gmail's sidebar rail).
 *
 * Additive without a version bump, unlike v2: this is frame → host only, so an
 * old host drops it through the guards below and behaves exactly as it does
 * today, and an old frame never sends it. Nothing can misread it.
 */
export const PANEL_DISABLED = "amarnai:panel:disabled" as const;
/**
 * The panel's comment list for the open thread changed (a comment was posted
 * or deleted there, or its poll discovered one). A nudge, not data: the host
 * re-fetches the badge counts through its own background path rather than
 * trusting numbers posted by a frame. Additive without a version bump, like
 * PANEL_DISABLED: an old host drops it and simply stays on its poll cadence.
 */
export const PANEL_COMMENTS_CHANGED = "amarnai:panel:commentsChanged" as const;

export type PanelReadyMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_READY;
};

export type PanelInsertDraftMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_INSERT_DRAFT;
  /** Correlates the host's answer with this request. */
  requestId: string;
  /** Draft body as HTML, already escaped by draftBodyToHtml. */
  html: string;
};

export type PanelOpenPanelMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_OPEN_PANEL;
};

export type PanelDisabledMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_DISABLED;
};

export type PanelCommentsChangedMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_COMMENTS_CHANGED;
};

export type PanelToHostMessage =
  | PanelReadyMessage
  | PanelInsertDraftMessage
  | PanelOpenPanelMessage
  | PanelDisabledMessage
  | PanelCommentsChangedMessage;

// ── Guards ────────────────────────────────────────────────────────────────────

function envelope(msg: unknown): Record<string, unknown> | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m["v"] !== PANEL_PROTOCOL_VERSION) return null;
  if (typeof m["type"] !== "string") return null;
  return m;
}

export function isPanelThreadContextMessage(msg: unknown): msg is PanelThreadContextMessage {
  const m = envelope(msg);
  if (!m || m["type"] !== PANEL_THREAD_CONTEXT) return false;
  const context = m["context"];
  if (context === null) return true;
  if (typeof context !== "object") return false;
  const c = context as Record<string, unknown>;
  const threadId = c["providerThreadId"];
  if (threadId !== null && typeof threadId !== "string") return false;
  // Null is a value here, not a missing field: a page that names no mailbox is
  // reported as such. Rejecting it would drop the message on the floor, which is
  // how the deeplink read view would go on showing no panel even with the hosts
  // fixed. `undefined` still fails, so a malformed message is still refused.
  const email = c["accountEmail"];
  if (email !== null && typeof email !== "string") return false;
  // Absent is the ordinary case (a conversation id). Anything present must be one
  // of the two known kinds: an unrecognized value would otherwise reach the API as
  // a ref the server rejects, turning a wrong id into a confusing 400 rather than
  // a message this guard refuses outright.
  const refKind = c["refKind"];
  return refKind === undefined || refKind === "thread" || refKind === "message";
}

export function isPanelVisibilityMessage(msg: unknown): msg is PanelVisibilityMessage {
  const m = envelope(msg);
  return !!m && m["type"] === PANEL_VISIBILITY && typeof m["visible"] === "boolean";
}

export function isPanelFocusCommentsMessage(msg: unknown): msg is PanelFocusCommentsMessage {
  const m = envelope(msg);
  return !!m && m["type"] === PANEL_FOCUS_COMMENTS;
}

export function isPanelInsertResultMessage(msg: unknown): msg is PanelInsertResultMessage {
  const m = envelope(msg);
  return (
    !!m &&
    m["type"] === PANEL_INSERT_RESULT &&
    typeof m["requestId"] === "string" &&
    typeof m["ok"] === "boolean"
  );
}

export function isPanelReadyMessage(msg: unknown): msg is PanelReadyMessage {
  const m = envelope(msg);
  return !!m && m["type"] === PANEL_READY;
}

export function isPanelInsertDraftMessage(msg: unknown): msg is PanelInsertDraftMessage {
  const m = envelope(msg);
  return (
    !!m &&
    m["type"] === PANEL_INSERT_DRAFT &&
    typeof m["requestId"] === "string" &&
    typeof m["html"] === "string"
  );
}

export function isPanelOpenPanelMessage(msg: unknown): msg is PanelOpenPanelMessage {
  const m = envelope(msg);
  return !!m && m["type"] === PANEL_OPEN_PANEL;
}

export function isPanelDisabledMessage(msg: unknown): msg is PanelDisabledMessage {
  const m = envelope(msg);
  return !!m && m["type"] === PANEL_DISABLED;
}

export function isPanelCommentsChangedMessage(msg: unknown): msg is PanelCommentsChangedMessage {
  const m = envelope(msg);
  return !!m && m["type"] === PANEL_COMMENTS_CHANGED;
}
