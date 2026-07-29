import type { TokenStore } from "@amarnai/api-client";

// The seam between the panel and the mail client it is rendered inside.
//
// There are two hosts and they could hardly be less alike: a cross-origin iframe
// inside Gmail, talking to a content script over postMessage, and an Office
// task pane inside Outlook, talking to Office.js. Everything they disagree about
// lives behind this interface, so the panel itself contains no branch on which
// mail client it happens to be in.
//
// The rule for adding to it: a method belongs here only if the two hosts must
// implement it differently. Anything both could share belongs in the panel.

/** Which conversation the mail client currently has open, and in which mailbox. */
export type PanelThreadContext = {
  /**
   * The provider's own thread id — the only id a mail page knows. Null when the
   * client is showing no conversation (a folder list), which is a state the
   * panel acts on rather than ignores: it shows the queue there.
   */
  providerThreadId: string | null;
  /** The mailbox reading it, which decides the workspace. */
  accountEmail: string;
};

/**
 * What this host can actually do, so the panel can hide affordances rather than
 * offer them and fail.
 *
 * `insertDraft` is the interesting one: both hosts have it today, but through
 * completely different machinery (Gmail's compose via the content script,
 * Outlook's `displayReplyForm`), and a future host may have neither. When it is
 * false the draft card still renders — copy-to-clipboard is always available —
 * it just does not offer to put the text into a reply.
 */
export type PanelCapabilities = {
  insertDraft: boolean;
  signIn: boolean;
  openExternal: boolean;
  /**
   * Whether the host can show a conversation in place. Gmail can (its router
   * reads the URL fragment); an Outlook task pane cannot, because Office.js
   * exposes no such call. Where it is false the queue links out instead, which
   * is why this gates an affordance rather than a whole feature.
   */
  openThread: boolean;
};

export type PanelHost = {
  capabilities: PanelCapabilities;

  /** Base URL of the Amarnai API this host reaches. */
  apiBaseUrl: string;

  /**
   * Where this host keeps its tokens. The two differ in kind, not just in
   * location: `chrome.storage` in the extension (shared with the side panel, and
   * observable, so a sign-in there wakes the injected panel up) versus
   * localStorage in the Outlook pane.
   */
  tokenStore: TokenStore;

  /**
   * Subscribe to conversation changes. Called with the current context
   * immediately if one is known, then on every change, and with null whenever
   * the user navigates away from a conversation (back to a folder list).
   * Returns an unsubscribe function.
   */
  onThreadContext(listener: (context: PanelThreadContext | null) => void): () => void;

  /**
   * Subscribe to the panel being shown or hidden. This is not document
   * visibility: a Gmail sidebar can be collapsed while its document stays
   * perfectly visible. Everything expensive — the SSE connection above all —
   * is gated on this. Returns an unsubscribe function.
   */
  onVisibilityChanged(listener: (visible: boolean) => void): () => void;

  /**
   * Hand an HTML draft to the mail client's own compose window. Resolves true
   * when the client accepted it. Never sends: composing is where Amarnai's
   * involvement ends, in both hosts, structurally.
   */
  insertDraft(html: string): Promise<boolean>;

  /**
   * Show a conversation in the mail client itself. Only called when
   * `capabilities.openThread` is true. Fire and forget: the host answers by
   * reporting the new conversation through `onThreadContext`, the same way it
   * would if the user had clicked the thread themselves.
   */
  openThread(providerThreadId: string): void;

  /** Bring the user to wherever this host signs people in. */
  requestSignIn(): void;

  /** Open a URL outside the panel (the web app). */
  openExternal(url: string): void;
};
