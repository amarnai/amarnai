import type { PanelHost, PanelThreadContext } from "@amarnai/panel";
import { extensionTokenStore } from "../auth/tokenStore";
import { API_BASE_URL } from "../config";
import { ext } from "../platform/ext";
import { OPEN_MAIL_THREAD_MESSAGE } from "../content/core/messaging";
import {
  PANEL_PROTOCOL_VERSION,
  PANEL_READY,
  PANEL_INSERT_DRAFT,
  PANEL_OPEN_PANEL,
  isPanelInsertResultMessage,
  isPanelThreadContextMessage,
  isPanelVisibilityMessage,
  type PanelToHostMessage,
} from "../content/core/panelProtocol";

// The panel's view of Gmail, from inside the iframe.
//
// Everything the panel needs about the page arrives over postMessage from the
// content script, because this document cannot see Gmail at all — which is the
// point. In exchange the tokens, the API calls, and the SSE stream live here,
// where nothing running on mail.google.com can reach them.

const INSERT_TIMEOUT_MS = 10_000;

/**
 * How long to wait for the embedder to say anything at all before telling the
 * panel there is no conversation.
 *
 * A spinner with no end is the worst thing this frame can render: it claims work
 * is happening and gives the reader nothing to do. If the host never speaks —
 * a content script that failed to start, a Gmail layout with no sidebar — the
 * panel should say so and let the user move on. Comfortably longer than the
 * host's own handshake retries, so this only fires when they have given up.
 */
const HANDSHAKE_TIMEOUT_MS = 8_000;

/**
 * The only page this panel may be embedded in. Gmail alone: Outlook gets the
 * panel through the Office add-in, not through an injected iframe, so there is
 * no second host to allow here. The manifest's web_accessible_resources already
 * restricts where the iframe is reachable from; this is the second lock, so a
 * page that somehow loads it still cannot drive it.
 */
const ALLOWED_PARENT_ORIGINS = new Set(["https://mail.google.com"]);

/**
 * The host, built once per document.
 *
 * This iframe IS the panel: there is exactly one embedder and one link to it,
 * and a host owns a window-level message listener plus the ready handshake. A
 * second instance would answer the same handshake twice and hold a listener
 * nothing ever removes — which is not hypothetical, because React StrictMode
 * runs the render that creates it twice in development.
 */
let instance: PanelHost | null = null;
let teardown: (() => void) | null = null;

export function createGmailPanelHost(): PanelHost {
  instance ??= buildGmailPanelHost();
  return instance;
}

/** Test seam: drop the instance and its listener between cases. */
export function resetGmailPanelHost(): void {
  teardown?.();
  teardown = null;
  instance = null;
}

function buildGmailPanelHost(): PanelHost {
  // Learned from the first inbound message, not from `document.referrer`.
  //
  // The referrer looked like the honest source — the browser sets it, a message
  // can claim anything — but for a chrome-extension:// iframe it is empty, so
  // the frame decided it had no trusted embedder, never sent its ready
  // handshake, and sat on "Loading…" forever waiting for a context the content
  // script was waiting for the handshake to send.
  //
  // `event.origin` is set by the browser on every message and cannot be forged
  // by the sender, so it is exactly as trustworthy as the referrer would have
  // been, and it actually exists here. The allowlist below is what makes it a
  // check rather than blind adoption; `event.source` pins it to the frame that
  // embedded us rather than any other frame on the page.
  let target: string | null = null;

  const contextListeners = new Set<(ctx: PanelThreadContext | null) => void>();
  const visibilityListeners = new Set<(visible: boolean) => void>();
  const pendingInserts = new Map<string, (ok: boolean) => void>();
  let insertCounter = 0;

  function post(message: PanelToHostMessage): void {
    if (target === null) return;
    // Targeted at the embedder, never "*": a wildcard would leak the message to
    // whatever page ends up hosting this frame.
    window.parent.postMessage(message, target);
  }

  // Safety net for a handshake that never completes. Cleared on the first
  // message from an allowed embedder, so in the ordinary case it never fires.
  const handshakeTimer = setTimeout(() => {
    if (target !== null) return;
    for (const listener of contextListeners) listener(null);
  }, HANDSHAKE_TIMEOUT_MS);

  const onMessage = (event: MessageEvent) => {
    // Both checks, always: the origin proves who sent it, the source proves it
    // was the frame that embedded us rather than some other frame on the page.
    if (event.source !== window.parent) return;
    if (target === null) {
      if (!ALLOWED_PARENT_ORIGINS.has(event.origin)) return;
      target = event.origin;
      clearTimeout(handshakeTimer);
      // Now that there is somewhere to send it: the handshake asks the content
      // script to replay the current conversation and visibility, so the panel
      // does not wait for the next Gmail mutation to learn where it is.
      post({ v: PANEL_PROTOCOL_VERSION, type: PANEL_READY });
    } else if (event.origin !== target) {
      return;
    }

    if (isPanelThreadContextMessage(event.data)) {
      const context = event.data.context;
      for (const listener of contextListeners) listener(context);
      return;
    }
    if (isPanelVisibilityMessage(event.data)) {
      for (const listener of visibilityListeners) listener(event.data.visible);
      return;
    }
    if (isPanelInsertResultMessage(event.data)) {
      const resolve = pendingInserts.get(event.data.requestId);
      if (resolve) {
        pendingInserts.delete(event.data.requestId);
        resolve(event.data.ok);
      }
    }
  };
  window.addEventListener("message", onMessage);

  teardown = () => {
    window.removeEventListener("message", onMessage);
    clearTimeout(handshakeTimer);
  };


  return {
    capabilities: {
      // The link to Gmail's compose is only live once an allowed embedder has
      // spoken — but so is everything else: a thread can only be on screen if
      // context arrived through that same channel. By the time there is a draft
      // to insert, the channel exists, so this is unconditionally true and
      // insertDraft() below still answers false if it somehow is not.
      insertDraft: true,
      signIn: true,
      openExternal: true,
      // Gmail routes on the URL fragment, so the content script can show a
      // conversation without a reload and without leaving the tab.
      openThread: true,
    },

    apiBaseUrl: API_BASE_URL,
    tokenStore: extensionTokenStore,

    onThreadContext(listener) {
      contextListeners.add(listener);
      return () => contextListeners.delete(listener);
    },

    onVisibilityChanged(listener) {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },

    insertDraft(html) {
      if (target === null) return Promise.resolve(false);
      const requestId = `insert-${++insertCounter}`;
      return new Promise<boolean>((resolve) => {
        // A host that never answers must not leave the panel's button spinning
        // forever; an unanswered insert is a failed insert.
        const timer = setTimeout(() => {
          pendingInserts.delete(requestId);
          resolve(false);
        }, INSERT_TIMEOUT_MS);
        pendingInserts.set(requestId, (ok) => {
          clearTimeout(timer);
          resolve(ok);
        });
        post({ v: PANEL_PROTOCOL_VERSION, type: PANEL_INSERT_DRAFT, requestId, html });
      });
    },

    openThread(providerThreadId) {
      // Through the background, not through the embedder: this frame is an
      // extension document, so it can ask for the tab it is in to be navigated
      // with chrome.tabs — the same call the side panel makes when a thread row
      // is clicked there. Routing it through the content script instead would
      // make opening a conversation depend on the postMessage channel and on a
      // write into Gmail's own location that nothing here can verify.
      //
      // Fire and forget: the panel has already switched to this thread's screen,
      // and the page reports itself through the ordinary context feed once it
      // catches up. A rejection means only that nothing was listening.
      void ext.runtime
        .sendMessage({ type: OPEN_MAIL_THREAD_MESSAGE, providerThreadId })
        .catch(() => {});
    },

    requestSignIn() {
      // Signing in happens in the extension's own panel. This frame cannot open
      // it (chrome.sidePanel needs a user gesture in an extension context the
      // content script owns), so the request is relayed through the host.
      post({ v: PANEL_PROTOCOL_VERSION, type: PANEL_OPEN_PANEL });
    },

    openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };
}
