import type { ProviderRefKind, TokenStore } from "@aziru/api-client";

// The seam between the panel and the mail client it is rendered inside.
//
// There are three hosts and they could hardly be less alike: an extension iframe
// in Gmail's sidebar and another in a drawer on Outlook Web, both talking to a
// content script over postMessage, and an Office task pane inside Outlook desktop
// talking to Office.js. Everything they disagree about lives behind this
// interface, so the panel itself contains no branch on which mail client it
// happens to be in.
//
// The rule for adding to it: a method belongs here only if the hosts must
// implement it differently. Anything they could share belongs in the panel.

/** Which conversation the mail client currently has open, and in which mailbox. */
export type PanelThreadContext = {
  /**
   * The provider's own thread id — the only id a mail page knows. Null when the
   * client is showing no conversation (a folder list), which is a state the
   * panel acts on rather than ignores: it shows the queue there.
   */
  providerThreadId: string | null;
  /**
   * The mailbox reading it, which decides the workspace.
   *
   * Null when the page could not name the mailbox at all — not the same thing as
   * a host reporting no context, which means it could not read the page. Some
   * mail layouts carry no account chrome whatsoever: OWA's standalone deeplink
   * read view has no header and no folder tree, so there is nowhere for an
   * address to be read from. The panel answers that by speaking for the single
   * connected mailbox when there is exactly one (see resolveMailbox in
   * usePanelState.ts), so a layout without account chrome still gets a panel.
   */
  accountEmail: string | null;
  /**
   * What kind of id `providerThreadId` is. Absent means a conversation id, which
   * is what every layout but one can name.
   *
   * "message" is OWA's standalone deeplink read view: an ITEM view with no
   * conversation id anywhere in its DOM, whose only id — taken from the deeplink
   * URL rather than the DOM — is the open message's. The server resolves it to
   * the containing thread. Passed through rather than guessed at, because both
   * flavors look alike.
   */
  refKind?: ProviderRefKind;
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
   * Whether the host can show a conversation in place. Gmail can, because its
   * router reads the URL fragment. Neither Outlook host can: Office.js exposes
   * no such call, and on OWA the conversation id the page hands out is not
   * URL-resolvable at all. Where it is false the queue links out instead, which
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
   * Subscribe to "expand + scroll the Comments section" requests — fired when
   * the user clicks an in-page comments control (the bubble on the injected
   * summary card). Returns an unsubscribe function.
   *
   * Optional because only a host with in-page chrome has anywhere to fire it
   * from: the Outlook task pane's whole surface is the panel, and its ribbon
   * entry point is expressed as the mount-time focusComments prop instead.
   */
  onFocusComments?(listener: () => void): () => void;

  /**
   * Tell the host the open thread's comment list changed (a post, a delete, or
   * the section's poll discovering one), so an in-page comments badge can
   * refresh immediately instead of waiting out its own poll. A nudge, not
   * data: the host re-fetches counts through its own path.
   *
   * Optional for the same reason as onFocusComments — only a host with
   * in-page chrome has a badge to refresh.
   */
  notifyCommentsChanged?(): void;

  /**
   * Hand an HTML draft to the mail client's own compose window. Resolves true
   * when the client accepted it. Never sends: composing is where Amarnai's
   * involvement ends, in both hosts, structurally.
   */
  insertDraft(html: string): Promise<boolean>;

  /**
   * Show a conversation in the mail client itself. Only called when
   * `capabilities.openThread` is true.
   *
   * Fire and forget, and nothing depends on the answer: the host ordinarily
   * reports the new conversation through `onThreadContext`, exactly as it would
   * if the user had clicked the thread themselves, but it is entitled to report
   * nothing at all — asking Gmail for the conversation it already has open is
   * not a change. The panel has already switched screens by then.
   */
  openThread(providerThreadId: string): void;

  /** Bring the user to wherever this host signs people in. */
  requestSignIn(): void;

  /**
   * The workspace has switched the injected panel off. Called once, when the API
   * says so, before the panel renders its own "switched off" screen.
   *
   * Optional because only a host that INJECTED something has anything to do here:
   * the extension's hosts remove the frame and the chrome holding it, so the kill
   * switch un-injects rather than leaving an inert panel on the mail page. The
   * Outlook task pane implements nothing — the user opened it deliberately and
   * the pane is the whole surface, so the message is the right answer there.
   */
  reportInjectionDisabled?(): void;

  /** Open a URL outside the panel (the web app). */
  openExternal(url: string): void;
};
