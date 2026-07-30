// Outlook-web content-script entrypoint. Injected at document_idle on all three
// OWA hosts (office.com / office365.com / live.com); see manifest.config.ts.
import { runContentScript } from "../core/runner.js";
import { detectOutlookThread, findOutlookInjectionAnchor } from "./detectThread.js";
import { startOutlookReplyButton } from "./replyButton.js";
import { startOutlookInjectedPanel } from "./panelHost.js";

try {
  runContentScript({
    detectThread: () => detectOutlookThread(),
    findInjectionAnchor: () => findOutlookInjectionAnchor(),
  });
} catch (e) {
  // A content script that throws on load must still leave OWA usable.
  console.debug("[amarnai] Outlook content script failed to start:", e);
}

// Independent of the summary widget above (same split as Gmail): the reply
// button watches the native [Reply] [Forward] row on its own schedule, so
// either feature can fail without taking the other down.
try {
  startOutlookReplyButton();
} catch (e) {
  console.warn("[amarnai] Amarnai Reply button (OWA) failed to start:", e);
}

// The third injected surface, independent of the other two for the same reason.
// It reads the drawer's remembered state from storage before it mounts, so it is
// a promise — and a rejection sails straight past a synchronous catch, hence the
// .catch as well as the try (same shape as the Gmail entrypoint).
try {
  startOutlookInjectedPanel().catch((e: unknown) => {
    console.warn("[amarnai] Amarnai panel (OWA) failed to start:", e);
  });
} catch (e) {
  console.warn("[amarnai] Amarnai panel (OWA) failed to start:", e);
}
