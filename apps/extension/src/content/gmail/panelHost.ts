import type { PanelThreadContext } from "@aziru/panel";
import { debugLog } from "../core/debug.js";
import { detectGmailThread, findAccountEmail } from "./detectThread.js";
import { hasInboxSdkAppId, loadInboxSDK } from "./inboxSdk.js";
import { armReply } from "./armedReply.js";
import { startDomTicker } from "../core/scheduler.js";
import { attachPanelFrame } from "../core/panelFrame.js";
import { inertPanelHandle, type InjectedPanelHandle } from "../core/panelHandle.js";
import { OPEN_PANEL_MESSAGE } from "../core/messaging.js";
import { claimFirstReveal } from "./firstReveal.js";
import { mountRailTab } from "./railTab.js";

// The Gmail half of the injected panel: an extension-origin iframe living in
// Gmail's own right-hand sidebar, fed the open conversation over postMessage.
//
// An iframe rather than DOM in the page, for one reason that decides everything
// else: the panel needs Aziru's session tokens, and a content script shares
// the page's origin. Putting the UI in an extension-origin document keeps the
// tokens, the API calls, and the SSE connection out of reach of anything running
// on mail.google.com — including Gmail itself.
//
// The postMessage link itself lives in core/panelFrame.ts, shared with the OWA
// drawer. What stays here is everything Gmail-shaped: mounting through InboxSDK,
// taking visibility from that sidebar's own activate/deactivate, reading the
// conversation out of Gmail's DOM, and arming the compose.

const PANEL_URL_PATH = "injected.html";
const PANEL_TITLE = "Aziru";
// The full logomark, not the reply button's single mirrored wedge: this is the
// entry point for Aziru as a whole in Gmail's rail, so it carries the brand
// mark rather than one feature's affordance.
const ICON_PATH = "panel-icon.svg";

/**
 * Watch the page for conversation changes and report them.
 *
 * Gmail is a single-page app: opening a conversation replaces DOM without any
 * navigation, so this rides the same throttled DOM ticker the summary widget and
 * the reply entry points use, and reports only on change. InboxSDK's
 * threadViewHandler covers the same ground but fires only for views it
 * recognizes; the DOM reader is what keeps `/u/1` multi-login safe, because it
 * reads the visible mailbox from the page rather than assuming the default one.
 */
function watchThreadContext(onChange: (context: PanelThreadContext | null) => void): () => void {
  let last = "";

  const check = () => {
    const accountEmail = findAccountEmail();
    const thread = detectGmailThread();
    // The address is reported even with no conversation open, because that is
    // the thread list — where the panel shows the queue, and where it still
    // needs to know which mailbox (and so which workspace) it is looking at.
    //
    // An unreadable address is reported as null rather than withheld, matching
    // the OWA host: the panel is the only side that knows how many mailboxes are
    // connected, so it is the side that decides whether one can be assumed.
    // Listing the wrong mailbox is still the thing to avoid, and still avoided —
    // with more than one connected the panel declines to choose.
    const next: PanelThreadContext = {
      providerThreadId: thread?.providerThreadId ?? null,
      accountEmail,
    };
    // Compare on value: the ticker fires on every Gmail mutation, and re-posting
    // an unchanged context would restart the panel's resolve on each of them.
    // The NUL separator keeps "no conversation" distinct from any real id.
    const key = `${accountEmail ?? ""}\0${next.providerThreadId ?? ""}`;
    if (key === last) return;
    last = key;
    onChange(next);
  };

  check();
  return startDomTicker(document, check);
}

/**
 * Put the Aziru panel in Gmail's sidebar.
 *
 * Resolves to a handle other features can point controls at (the summary
 * card's comment bubble); every no-panel path resolves to the inert handle. A
 * missing InboxSDK app id is not an error: a build without one simply ships no
 * panel, which is how self-hosters who have not registered with InboxSDK run
 * the extension.
 */
export async function startInjectedPanel(
  options: { onCommentsChanged?: () => void } = {},
): Promise<InjectedPanelHandle> {
  if (!hasInboxSdkAppId()) {
    debugLog("panel: no VITE_INBOXSDK_APP_ID in this build — panel disabled");
    return inertPanelHandle;
  }

  const sdk = await loadInboxSDK();
  debugLog("panel: InboxSDK ready — mounting sidebar panel");

  const container = document.createElement("div");
  container.style.cssText = "height:100%;width:100%;display:flex;";

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL(PANEL_URL_PATH);
  iframe.title = PANEL_TITLE;
  iframe.style.cssText = "flex:1 1 auto;border:0;width:100%;height:100%;min-height:320px;";
  // Permissions Policy defaults clipboard-write to the embedder alone, so the
  // panel's "Copy" silently rejected until Gmail's page delegated it to this
  // frame. Nothing else is granted.
  iframe.setAttribute("allow", "clipboard-write");
  // The panel loads no third-party content and needs no elevated privileges from
  // its frame; sandbox is left off deliberately, because an extension-origin
  // iframe needs same-origin storage access to read its own tokens.
  container.appendChild(iframe);

  // Assigned once the sidebar has actually mounted, and read by `stop` below —
  // which the disable relay can fire at any point after the frame loads, so the
  // teardown has to be reachable from a closure created before it exists.
  let teardown: (() => void) | null = null;
  const stop = () => {
    const run = teardown;
    teardown = null; // idempotent: a relayed disable and an explicit stop can race
    run?.();
  };

  const link = attachPanelFrame({
    iframe,
    onInsertDraft: openReplyWithArmedDraft,
    onOpenPanel: () => {
      // Sign-in happens in the extension's own panel: an OAuth flow started from
      // inside a third-party page is neither reliable nor trustworthy.
      void chrome.runtime.sendMessage({ type: OPEN_PANEL_MESSAGE });
    },
    onDisabled: () => {
      // The workspace switched the panel off. Remove the sidebar entry outright,
      // exactly as the reply button removes itself: an inert panel sitting in
      // Gmail's rail is not what "switched off" should look like. Re-enabling
      // takes a reload, which is the same bargain the other two surfaces make.
      debugLog("panel: disabled for this workspace — removing the sidebar entry");
      stop();
    },
    ...(options.onCommentsChanged ? { onCommentsChanged: options.onCommentsChanged } : {}),
  });

  const sidebarPanel = await sdk.Global.addSidebarContentPanel({
    el: container,
    title: PANEL_TITLE,
    iconUrl: chrome.runtime.getURL(ICON_PATH),
  });
  if (!sidebarPanel) {
    // InboxSDK returns null when Gmail offers no global sidebar to mount into
    // (an older layout, or a view it does not recognize). Not an error worth
    // shouting about: the page keeps working with no panel.
    debugLog("panel: Gmail exposed no sidebar to mount into");
    link.stop();
    return inertPanelHandle;
  }

  // The visible entry point (see railTab.ts): the rail slot itself cannot be
  // made bigger, so the tab is DOM of our own. Hidden while the panel is
  // active — an "open" control over an already-open panel is noise.
  const railTab = mountRailTab(document, () => sidebarPanel.open());

  // A collapsed sidebar is not a hidden document: Gmail keeps the panel in the
  // DOM. Without this the panel would hold an SSE connection open for a surface
  // nobody is looking at.
  const onActivate = () => {
    link.setVisible(true);
    railTab.setHidden(true);
  };
  const onDeactivate = () => {
    link.setVisible(false);
    railTab.setHidden(false);
  };
  sidebarPanel.on("activate", onActivate);
  sidebarPanel.on("deactivate", onDeactivate);

  // The sidebar starts collapsed in Gmail, so the panel must not assume it is
  // being looked at until an activate says so. The frame is not loaded yet, so
  // this send goes nowhere and the handshake carries the value across.
  link.setVisible(sidebarPanel.isActive());
  railTab.setHidden(sidebarPanel.isActive());

  const stopWatching = watchThreadContext(link.postContext);

  teardown = () => {
    link.stop();
    stopWatching();
    railTab.remove();
    sidebarPanel.off("activate", onActivate);
    sidebarPanel.off("deactivate", onDeactivate);
    sidebarPanel.remove();
  };

  // The one-time self-introduction (see firstReveal.ts). Guarded like reveal():
  // the disable relay can fire during the storage read, and a removed panel must
  // not be reopened.
  if ((await claimFirstReveal()) && teardown !== null) sidebarPanel.open();

  // `teardown` doubling as the liveness flag is what keeps the handle honest
  // after the kill-switch relay: onDisabled runs the same stop(), which nulls
  // it, and every handle method checks it first.
  return {
    stop,
    reveal() {
      if (teardown) sidebarPanel.open();
    },
    focusComments() {
      if (teardown) link.focusComments();
    },
    isLive: () => teardown !== null,
  };
}

/**
 * Arm the open conversation with the panel's draft and click Gmail's own Reply
 * control.
 *
 * The draft travels with the arm rather than being re-fetched by the compose:
 * the panel is already showing this exact text, and a second request could
 * return a different draft — or generate one, since the panel marks the draft
 * sent the moment the insertion is accepted and a sent draft is no longer
 * reusable. Insertion itself still happens in the one place it always has
 * (replyButton.ts). Returns false when there is no conversation open or no
 * reply control to click; the panel then leaves its "insert" affordance alone
 * rather than claiming success.
 */
function openReplyWithArmedDraft(html: string): boolean {
  const thread = detectGmailThread();
  if (!thread) return false;

  const nativeReply = document.querySelector<HTMLElement>("span.ams.bkH");
  if (!nativeReply) {
    debugLog("panel: no native Reply control found — cannot insert");
    return false;
  }

  armReply(thread.providerThreadId, html);
  nativeReply.click();
  return true;
}
