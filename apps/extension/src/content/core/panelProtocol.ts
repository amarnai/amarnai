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

export const PANEL_PROTOCOL_VERSION = 1;

// ── Host → iframe ─────────────────────────────────────────────────────────────

export const PANEL_THREAD_CONTEXT = "amarnai:panel:threadContext" as const;
export const PANEL_VISIBILITY = "amarnai:panel:visibility" as const;
export const PANEL_INSERT_RESULT = "amarnai:panel:insertResult" as const;

export type PanelThreadContextMessage = {
  v: typeof PANEL_PROTOCOL_VERSION;
  type: typeof PANEL_THREAD_CONTEXT;
  /** Null when the mail client is not showing a conversation. */
  context: { providerThreadId: string; accountEmail: string } | null;
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

export type HostToPanelMessage =
  | PanelThreadContextMessage
  | PanelVisibilityMessage
  | PanelInsertResultMessage;

// ── Iframe → host ─────────────────────────────────────────────────────────────

export const PANEL_READY = "amarnai:panel:ready" as const;
export const PANEL_INSERT_DRAFT = "amarnai:panel:insertDraft" as const;
export const PANEL_OPEN_PANEL = "amarnai:panel:openPanel" as const;

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

export type PanelToHostMessage =
  | PanelReadyMessage
  | PanelInsertDraftMessage
  | PanelOpenPanelMessage;

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
  return typeof c["providerThreadId"] === "string" && typeof c["accountEmail"] === "string";
}

export function isPanelVisibilityMessage(msg: unknown): msg is PanelVisibilityMessage {
  const m = envelope(msg);
  return !!m && m["type"] === PANEL_VISIBILITY && typeof m["visible"] === "boolean";
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
