import type { PanelThreadContext } from "@aziru/panel";
import { debugLog } from "../core/debug.js";
import { createLogoMark } from "../core/logoMark.js";
import { EDGE_TAB_CSS } from "../core/edgeTabStyles.js";
import { attachPanelFrame } from "../core/panelFrame.js";
import { inertPanelHandle, type InjectedPanelHandle } from "../core/panelHandle.js";
import { startDomTicker } from "../core/scheduler.js";
import { OPEN_PANEL_MESSAGE } from "../core/messaging.js";
import { PANEL_EMBED_PARAM } from "../core/panelProtocol.js";
import { PANEL_TAB_STRINGS } from "../core/strings.js";
import { ext } from "../../platform/ext.js";
import { findAccountEmail, readOpenThreadRef } from "./detectThread.js";
import { armOutlookReplyWithDraft } from "./replyButton.js";

// The OWA half of the injected panel: the same extension-origin iframe Gmail
// embeds, in a drawer of our own on the right edge of the page.
//
// A drawer rather than a host sidebar because OWA offers nothing to mount into.
// InboxSDK is Gmail's alone, and the Office add-in's task pane needs the add-in
// installed — which reaches Outlook desktop, where a content script cannot go,
// but leaves every OWA user without a panel. The two can be on at once; that
// costs a collapsed tab beside the pane and is the accepted price of covering
// both surfaces.
//
// The postMessage link is core/panelFrame.ts, shared with Gmail. What is OWA's
// own: the drawer itself, taking visibility from whether it is expanded, reading
// the conversation out of OWA's DOM, and arming its reply.

const PANEL_HOST_ATTRIBUTE = "data-aziru-owa-panel";
const PANEL_URL_PATH = "injected.html";

/**
 * Remembers the drawer open across reloads — an account switch is a real one.
 * Never written yet means the very first visit, and that is the one time the
 * drawer starts expanded on its own: a collapsed 30px tab was being missed
 * outright, and one self-introduction is how the Gmail panel handles the same
 * problem. The first collapse writes `false` and ends it.
 */
const EXPANDED_KEY = "owaPanelExpanded";

/**
 * How far down the right edge the collapse tab sits.
 *
 * One constant because this is the number QA tunes: OWA's own right-hand app
 * rail (Copilot, My Day, add-ins) runs down this edge and its icons cluster
 * toward the middle, so a tab at 50% lands squarely on them. Below the cluster
 * and above the fold is the gap that works on all three hosts.
 */
const TAB_TOP = "64%";

/** Wide enough to read, never wider than the window minus its own tab. */
const DRAWER_WIDTH = "min(360px, calc(100vw - 40px))";

/**
 * Above Fluent UI's `ms-Layer`, which OWA renders dialogs and callouts into at
 * around z-index 1,000,000. The drawer has to clear that to be usable at all,
 * which does mean an expanded drawer sits over an OWA modal — acceptable only
 * because past the first visit it starts collapsed, so what usually overlaps by
 * default is a 30px tab. Deliberately no backdrop of our own: that would be
 * obstructive.
 */
const Z_INDEX = 2147483000;

// The tab's skin is the shared clay edge-tab look (core/edgeTabStyles.ts, also
// the Gmail rail tab's) — it reads correctly against OWA light and dark alike,
// so the tab needs none of the backdrop-measuring the summary card does.
// Everything below the tab is the iframe, which themes itself from the same
// storage the side panel writes.
const STYLES = `
:host {
  all: initial;
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  z-index: ${Z_INDEX};
  display: flex;
  align-items: flex-start;
  /* The host spans the full edge so the drawer can be full height, but only its
     two real controls take clicks — the rest of that column belongs to OWA. */
  pointer-events: none;
}
.tab, .drawer { pointer-events: auto; }
${EDGE_TAB_CSS}
.tab {
  margin-top: ${TAB_TOP};
  flex: none;
  width: 30px;
  height: 58px;
}
.drawer {
  width: 0;
  height: 100vh;
  overflow: hidden;
  background: transparent;
  /* Animate the wrapper, never the fixed host: a transform on the host would
     make its own position: fixed resolve against itself. */
  transition: width 160ms ease;
}
:host([data-expanded="true"]) .drawer {
  width: ${DRAWER_WIDTH};
  box-shadow: -2px 0 16px rgb(0 0 0 / 0.18);
}
.frame {
  width: ${DRAWER_WIDTH};
  height: 100%;
  border: 0;
  display: block;
}
@media (prefers-reduced-motion: reduce) {
  .drawer { transition: none; }
}
`;

/** What the panel is told about the page, on every change and only on a change. */
function watchThreadContext(
  doc: Document,
  onChange: (context: PanelThreadContext | null) => void,
): () => void {
  let last = "";

  const check = () => {
    const accountEmail = findAccountEmail(doc);
    // readOpenThreadRef is gated on isConversationOpen, and that gate is the
    // whole difference between this reader and the summary card's. OWA leaves a
    // row selected in the list when the reading pane is empty, so
    // findConversationId alone would report a conversation nobody opened — and
    // the panel would then show a thread screen offering to insert a draft into a
    // reply form that is not on the page.
    const ref = readOpenThreadRef(doc);
    const providerThreadId = ref?.providerThreadId ?? null;
    // The address is reported even with no conversation open, because that is
    // the folder list — where the panel shows the queue, and where it still
    // needs to know which mailbox (and so which workspace) it is looking at.
    //
    // An unreadable address is reported too, as null rather than as no context
    // at all, and the panel decides what to do with it: OWA's standalone
    // deeplink read view has no account header and no folder tree, so there is
    // no address to be had on a page that is nonetheless showing a conversation
    // the panel can speak about. Giving up here would have been the panel's
    // answer for that whole layout.
    const next: PanelThreadContext = {
      providerThreadId,
      accountEmail,
      refKind: ref?.refKind ?? "thread",
    };
    // Compare on value: the ticker fires on every OWA mutation, and re-posting
    // an unchanged context would restart the panel's resolve on each of them.
    // The NUL separator keeps "no conversation" distinct from any real id.
    const key = `${accountEmail ?? ""}\0${providerThreadId ?? ""}`;
    if (key === last) return;
    last = key;
    onChange(next);
  };

  check();
  return startDomTicker(doc, check);
}

/**
 * Whether the drawer starts open: the remembered state, or expanded on the very
 * first visit (see EXPANDED_KEY). Unreadable storage means collapsed — a drawer
 * that pops open on every load because storage keeps failing is the one thing
 * the first-visit rule must not decay into.
 */
async function readExpanded(): Promise<boolean> {
  try {
    const stored = await ext.storage.local.get(EXPANDED_KEY);
    if (!(EXPANDED_KEY in stored)) return true;
    return stored[EXPANDED_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Put the Aziru panel on the right edge of OWA. Resolves to a handle other
 * features can point controls at (the summary card's comment bubble); the
 * no-panel paths resolve to the inert handle.
 *
 * Async because the drawer's remembered state has to be read from storage before
 * the frame is told whether anyone is looking at it — otherwise the panel opens
 * an SSE connection for a drawer that turns out to be shut, or shows expanded
 * for a frame and then collapses under the user.
 */
export async function startOutlookInjectedPanel(
  doc: Document = document,
  options: { onCommentsChanged?: () => void } = {},
): Promise<InjectedPanelHandle> {
  if (doc.querySelector(`[${PANEL_HOST_ATTRIBUTE}]`)) {
    // Already mounted — a second drawer would answer the same handshake twice.
    debugLog("panel (owa): already mounted");
    return inertPanelHandle;
  }

  const expanded = await readExpanded();

  const host = doc.createElement("div");
  host.setAttribute(PANEL_HOST_ATTRIBUTE, "");
  host.setAttribute("data-expanded", String(expanded));
  // A shadow root, following the summary card: the tab is a real button with a
  // focus ring and a hover state, and OWA's global resets plus Fluent's
  // runtime-injected rules would otherwise reach its font, colour and outline.
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = STYLES;

  const tab = doc.createElement("button");
  tab.type = "button";
  tab.className = "tab";
  tab.setAttribute("aria-expanded", String(expanded));
  tab.setAttribute("aria-label", expanded ? PANEL_TAB_STRINGS.close : PANEL_TAB_STRINGS.open);
  tab.title = PANEL_TAB_STRINGS.title;
  tab.append(createLogoMark(doc, 20));

  const drawer = doc.createElement("div");
  drawer.className = "drawer";

  const iframe = doc.createElement("iframe");
  // The embed parameter tells the frame which allowlist to hold itself to and
  // which affordances to offer. Built from a path, because getURL takes a path.
  iframe.src = `${chrome.runtime.getURL(PANEL_URL_PATH)}?${PANEL_EMBED_PARAM}=outlook`;
  iframe.title = PANEL_TAB_STRINGS.title;
  iframe.className = "frame";
  // Permissions Policy defaults clipboard-write to the embedder alone, so the
  // panel's "Copy" rejects unless OWA's own header delegates it here. The draft
  // card falls back to execCommand when it does not; nothing else is granted.
  iframe.setAttribute("allow", "clipboard-write");
  // No sandbox, deliberately: an extension-origin iframe needs same-origin
  // storage access to read its own tokens.
  drawer.append(iframe);

  root.append(style, tab, drawer);

  // Assigned once the drawer is fully wired, and read by `stop` below — which the
  // disable relay can fire at any point after the frame loads, so the teardown has
  // to be reachable from a closure created before it exists.
  let teardown: (() => void) | null = null;
  const stop = () => {
    const run = teardown;
    teardown = null; // idempotent: a relayed disable and an explicit stop can race
    run?.();
  };

  const link = attachPanelFrame({
    iframe,
    onInsertDraft: (html) => {
      // The same reading the context feed uses, so the two cannot disagree about
      // whether there is a conversation to insert into. They did once: on the
      // deeplink read view this path resolved nothing while the feed resolved the
      // message id, and the panel offered a draft it could never place.
      const ref = readOpenThreadRef(doc);
      if (!ref) {
        debugLog("panel (owa): no conversation open — cannot insert");
        return false;
      }
      // The id is only an arm-staleness key for the pill, and it is keyed the same
      // way the pill's own ticker keys it (detectOutlookThread also reports the
      // message id on this layout), so the arm is not dropped as a thread switch.
      return armOutlookReplyWithDraft(doc, ref.providerThreadId, html);
    },
    onOpenPanel: () => {
      // Sign-in happens in the extension's own panel: an OAuth flow started from
      // inside a third-party page is neither reliable nor trustworthy.
      try {
        chrome.runtime.sendMessage({ type: OPEN_PANEL_MESSAGE });
      } catch {
        // The panel stays reachable from the toolbar icon.
      }
    },
    onDisabled: () => {
      // The workspace switched the panel off. The drawer goes with it — tab
      // included, which is the point: a tab pinned above OWA's own dialog layer is
      // the last thing a workspace that turned the panel off should still see.
      // Re-enabling takes a reload, as it does for the reply pill.
      debugLog("panel (owa): disabled for this workspace — removing the drawer");
      stop();
    },
    ...(options.onCommentsChanged ? { onCommentsChanged: options.onCommentsChanged } : {}),
  });

  // Seeded before the frame can load, so the opening handshake already carries
  // the right answer rather than correcting itself a moment later.
  link.setVisible(expanded);

  let isExpanded = expanded;
  function setExpanded(next: boolean): void {
    isExpanded = next;
    host.setAttribute("data-expanded", String(next));
    tab.setAttribute("aria-expanded", String(next));
    tab.setAttribute("aria-label", next ? PANEL_TAB_STRINGS.close : PANEL_TAB_STRINGS.open);
    link.setVisible(next);
    // Fire and forget: a storage write that fails costs the user one click after
    // the next reload, which is not worth surfacing on their mail page.
    void Promise.resolve(ext.storage.local.set({ [EXPANDED_KEY]: next })).catch(() => {});
  }
  const onTabClick = () => setExpanded(!isExpanded);
  tab.addEventListener("click", onTabClick);

  // Appended to the body and nowhere else. `position: fixed` resolves against
  // the nearest ancestor carrying transform / filter / contain / will-change
  // rather than against the viewport, and OWA's panes are full of all four — so
  // mounting inside one would put the drawer somewhere arbitrary.
  doc.body.append(host);
  debugLog("panel (owa): drawer mounted", expanded ? "(expanded)" : "(collapsed)");

  const stopWatching = watchThreadContext(doc, link.postContext);

  teardown = () => {
    link.stop();
    stopWatching();
    tab.removeEventListener("click", onTabClick);
    host.remove();
  };

  // `teardown` doubles as the liveness flag, exactly as in the Gmail host: the
  // kill-switch relay runs the same stop(), which nulls it.
  return {
    stop,
    reveal() {
      // Through setExpanded so the drawer's remembered state and the frame's
      // visibility gate stay correct, same as a tab click.
      if (teardown && !isExpanded) setExpanded(true);
    },
    focusComments() {
      if (teardown) link.focusComments();
    },
    isLive: () => teardown !== null,
  };
}
