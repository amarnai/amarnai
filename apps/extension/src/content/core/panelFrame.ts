import type { PanelThreadContext } from "@amarnai/panel";
import { debugLog } from "./debug.js";
import {
  PANEL_PROTOCOL_VERSION,
  PANEL_THREAD_CONTEXT,
  PANEL_VISIBILITY,
  PANEL_INSERT_RESULT,
  PANEL_FOCUS_COMMENTS,
  isPanelCommentsChangedMessage,
  isPanelDisabledMessage,
  isPanelInsertDraftMessage,
  isPanelOpenPanelMessage,
  isPanelReadyMessage,
  type HostToPanelMessage,
} from "./panelProtocol.js";

// The content-script end of the link to the panel iframe, shared by both
// providers.
//
// Gmail and OWA disagree about everything around this — where the frame is
// mounted, where visibility comes from, how a draft reaches the compose — but
// the link itself is the same on both: adopt the extension origin, speak first
// and keep speaking until answered, and accept nothing that fails both the
// origin and the source check.
//
// Shared rather than copied specifically because of that last part. The two
// checks in `onMessage` are a security control, and a duplicated security
// control is one a future fix silently leaves half-applied.

/** How often to repeat the opening message while the frame stays silent. */
const HELLO_INTERVAL_MS = 250;
/** ~5s, then give up rather than poll a dead frame. */
const HELLO_ATTEMPTS = 20;

export type PanelFrameOptions = {
  /** The panel iframe, already pointed at injected.html. */
  iframe: HTMLIFrameElement;
  /**
   * Put this draft into the mail client's own compose. Returns whether the
   * client took it; the answer goes back to the panel, which only marks a draft
   * sent on a true.
   */
  onInsertDraft: (html: string) => boolean;
  /** The panel asked for the extension's own side panel (its sign-in surface). */
  onOpenPanel: () => void;
  /**
   * The workspace has switched the panel off. Remove the whole surface — the
   * frame and whatever chrome holds it — rather than leaving an inert panel in
   * place; see PANEL_DISABLED.
   *
   * Required, not optional: a host that mounts something into a mail page has to
   * have an answer for being switched off, and making this optional is how the
   * two hosts would end up with different ones.
   */
  onDisabled: () => void;
  /**
   * The panel's comment list for the open thread changed. Optional: only a
   * host with an in-page comments badge has anything to refresh.
   */
  onCommentsChanged?: () => void;
};

export type PanelFrameLink = {
  /** Tell the panel which conversation the page has open, or null for none. */
  postContext(context: PanelThreadContext | null): void;
  /** Tell the panel whether anyone is looking at it. Gates the SSE connection. */
  setVisible(visible: boolean): void;
  /**
   * Ask the panel to expand + scroll its Comments section. Fire-and-forget and
   * an event rather than state: it is NOT replayed by the handshake, so a
   * frame that reloads never spontaneously re-focuses comments.
   */
  focusComments(): void;
  /** Drop the listeners and stop the handshake. */
  stop(): void;
};

/** The iframe's own origin — the only origin whose messages the host accepts. */
function extensionOrigin(): string {
  return new URL(chrome.runtime.getURL("/")).origin;
}

export function attachPanelFrame({
  iframe,
  onInsertDraft,
  onOpenPanel,
  onDisabled,
  onCommentsChanged,
}: PanelFrameOptions): PanelFrameLink {
  const origin = extensionOrigin();
  let pendingContext: PanelThreadContext | null = null;
  let lastVisible = true;

  function post(message: HostToPanelMessage): void {
    // Targeted at the extension origin, never "*": a wildcard target would hand
    // the message to whatever ends up in that frame.
    iframe.contentWindow?.postMessage(message, origin);
  }

  function postState(): void {
    post({ v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: pendingContext });
    post({ v: PANEL_PROTOCOL_VERSION, type: PANEL_VISIBILITY, visible: lastVisible });
  }

  // The host speaks first, and keeps speaking until answered.
  //
  // The iframe cannot address us until it has seen a message from us: it learns
  // our origin from `event.origin`, which only a real message carries. So the
  // handshake cannot start on its side. `load` is the natural moment, but it is
  // not enough on its own — the frame's listener is attached by its bundle,
  // which may still be parsing when `load` fires for a cached document — so the
  // opening message repeats on a short interval until the frame's `ready` comes
  // back. Every send is idempotent (current context, current visibility).
  let helloTimer: ReturnType<typeof setInterval> | null = null;
  let helloAttempts = 0;

  function stopHello(): void {
    if (helloTimer) {
      clearInterval(helloTimer);
      helloTimer = null;
    }
  }

  function startHello(): void {
    stopHello();
    helloAttempts = 0;
    postState();
    helloTimer = setInterval(() => {
      if (++helloAttempts >= HELLO_ATTEMPTS) {
        stopHello();
        debugLog("panel: iframe never answered the handshake");
        return;
      }
      postState();
    }, HELLO_INTERVAL_MS);
  }

  iframe.addEventListener("load", startHello);

  // ── Iframe → host ───────────────────────────────────────────────────────────
  const onMessage = (event: MessageEvent) => {
    // Both checks, always: the origin proves who sent it, the source proves it
    // was OUR frame and not some other extension-origin document on the page.
    if (event.origin !== origin) return;
    if (event.source !== iframe.contentWindow) return;

    if (isPanelReadyMessage(event.data)) {
      // Answered: stop repeating, and send once more so the frame has the state
      // as of now rather than as of whichever repeat it happened to catch.
      stopHello();
      postState();
      return;
    }

    if (isPanelInsertDraftMessage(event.data)) {
      const { requestId, html } = event.data;
      const ok = onInsertDraft(html);
      post({ v: PANEL_PROTOCOL_VERSION, type: PANEL_INSERT_RESULT, requestId, ok });
      return;
    }

    if (isPanelOpenPanelMessage(event.data)) {
      onOpenPanel();
      return;
    }

    if (isPanelCommentsChangedMessage(event.data)) {
      onCommentsChanged?.();
      return;
    }

    if (isPanelDisabledMessage(event.data)) {
      // The host tears itself down, which drops this listener too — so the
      // handshake is stopped first rather than left running against a frame that
      // is about to be removed.
      stopHello();
      onDisabled();
    }
  };
  window.addEventListener("message", onMessage);

  return {
    postContext(context) {
      pendingContext = context;
      post({ v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context });
    },

    setVisible(visible) {
      lastVisible = visible;
      // Recorded as well as sent, because the frame may not have loaded yet —
      // in which case this post goes nowhere and the handshake carries the value
      // across instead.
      post({ v: PANEL_PROTOCOL_VERSION, type: PANEL_VISIBILITY, visible });
    },

    focusComments() {
      post({ v: PANEL_PROTOCOL_VERSION, type: PANEL_FOCUS_COMMENTS });
    },

    stop() {
      stopHello();
      iframe.removeEventListener("load", startHello);
      window.removeEventListener("message", onMessage);
    },
  };
}
