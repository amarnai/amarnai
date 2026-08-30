// Gmail content-script entrypoint. Injected at document_idle on
// https://mail.google.com/*; see manifest.config.ts.
import { runContentScript, type ContentScriptController } from "../core/runner.js";
import { inertPanelHandle, type InjectedPanelHandle } from "../core/panelHandle.js";
import { detectGmailThread, findGmailInjectionAnchor, findAccountEmail } from "./detectThread.js";
import { startReplyButton } from "./replyButtonHost.js";
import { startInjectedPanel } from "./panelHost.js";

// The summary card's comment bubble targets the sidebar panel, but the two
// features stay decoupled (either can fail alone): the widget only ever sees
// this slot and the promise below. While the panel is still starting
// (InboxSDK.load takes seconds; the summary and count responses often land
// first) the target counts as live OPTIMISTICALLY — the panel mounts in the
// overwhelmingly common case, and a click meanwhile just waits on the promise.
// Once the start settles, the resolved handle is the whole truth: inert or
// torn down means no bubble from the next render on.
let panelHandle: InjectedPanelHandle | null = null;
// Filled once runContentScript returns; the panel's commentsChanged nudge
// routes through it so the bubble refreshes the moment a comment is posted.
let content: ContentScriptController | null = null;

// The sidebar panel. Independent of the other injected features — it shares
// only the one memoized InboxSDK.load — so any of them can fail without taking
// the others down. The failure is absorbed into an inert handle rather than a
// rejection: every consumer of the promise wants "a handle, possibly dead",
// never an exception.
const panelStart: Promise<InjectedPanelHandle> = startInjectedPanel({
  onCommentsChanged: () => content?.refreshComments(),
})
  .catch((e: unknown) => {
    console.warn("[aziru] Amarnai panel failed to start:", e);
    return inertPanelHandle;
  })
  .then((handle) => {
    panelHandle = handle;
    return handle;
  });

try {
  content = runContentScript({
    detectThread: () => detectGmailThread(),
    findInjectionAnchor: () => findGmailInjectionAnchor(),
    // Gmail's message rows start past an avatar gutter; without this the card
    // hangs left of the conversation it annotates.
    gutterLeft: "12px",
    onOpenComments: () => {
      void panelStart.then((handle) => {
        handle.reveal();
        handle.focusComments();
      });
    },
    isCommentsTargetLive: () => (panelHandle ? panelHandle.isLive() : true),
  });
} catch (e) {
  // A content script that throws on load must still leave Gmail usable.
  console.debug("[aziru] Gmail content script failed to start:", e);
}

// Independent of the summary widget above: the button lives in Gmail's compose,
// which InboxSDK surfaces on its own schedule, so it does not go through the
// runner's single-widget/one-anchor machinery. Either feature can fail without
// taking the other down. The failure is reported through .catch, NOT a
// try/catch — startReplyButton is async (InboxSDK.load), and a rejection would
// sail straight past a synchronous catch block and vanish.
startReplyButton({ getAccountEmail: () => findAccountEmail() }).catch(
  (e: unknown) => {
    console.warn("[aziru] Amarnai Reply button failed to start:", e);
  },
);

