// Outlook-web content-script entrypoint. Injected at document_idle on all three
// OWA hosts (office.com / office365.com / live.com); see manifest.config.ts.
import { runContentScript, type ContentScriptController } from "../core/runner.js";
import { inertPanelHandle, type InjectedPanelHandle } from "../core/panelHandle.js";
import { detectOutlookThread, findOutlookInjectionAnchor } from "./detectThread.js";
import { startOutlookReplyButton } from "./replyButton.js";
import { startOutlookInjectedPanel } from "./panelHost.js";

// Same bridge as the Gmail entrypoint: the summary card's comment bubble
// targets the drawer, but the features stay decoupled. While the panel start
// is still pending the target counts as live optimistically (the drawer
// mounts in the ordinary case; a click meanwhile waits on the promise); once
// settled, the handle is the whole truth.
let panelHandle: InjectedPanelHandle | null = null;
// Filled once runContentScript returns; the panel's commentsChanged nudge
// routes through it so the bubble refreshes the moment a comment is posted.
let content: ContentScriptController | null = null;

// The drawer, absorbed into an inert handle on any failure — sync throw or
// rejection — because every consumer wants "a handle, possibly dead", never an
// exception.
const panelStart: Promise<InjectedPanelHandle> = (() => {
  try {
    return startOutlookInjectedPanel(document, {
      onCommentsChanged: () => content?.refreshComments(),
    }).catch((e: unknown) => {
      console.warn("[aziru] Aziru panel (OWA) failed to start:", e);
      return inertPanelHandle;
    });
  } catch (e) {
    console.warn("[aziru] Aziru panel (OWA) failed to start:", e);
    return Promise.resolve(inertPanelHandle);
  }
})().then((handle) => {
  panelHandle = handle;
  return handle;
});

try {
  content = runContentScript({
    detectThread: () => detectOutlookThread(),
    findInjectionAnchor: () => findOutlookInjectionAnchor(),
    onOpenComments: () => {
      void panelStart.then((handle) => {
        handle.reveal();
        handle.focusComments();
      });
    },
    isCommentsTargetLive: () => (panelHandle ? panelHandle.isLive() : true),
  });
} catch (e) {
  // A content script that throws on load must still leave OWA usable.
  console.debug("[aziru] Outlook content script failed to start:", e);
}

// Independent of the summary widget above (same split as Gmail): the reply
// button watches the native [Reply] [Forward] row on its own schedule, so
// either feature can fail without taking the other down.
try {
  startOutlookReplyButton();
} catch (e) {
  console.warn("[aziru] Aziru Reply button (OWA) failed to start:", e);
}

