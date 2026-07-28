// Outlook-web content-script entrypoint. Injected at document_idle on all three
// OWA hosts (office.com / office365.com / live.com); see manifest.config.ts.
import { runContentScript } from "../core/runner.js";
import { detectOutlookThread, findOutlookInjectionAnchor } from "./detectThread.js";
import { startOutlookReplyButton } from "./replyButton.js";

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
