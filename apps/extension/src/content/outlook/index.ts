// Outlook-web content-script entrypoint. Injected at document_idle on all three
// OWA hosts (office.com / office365.com / live.com); see manifest.config.ts.
import { runContentScript } from "../core/runner.js";
import { detectOutlookThread, findOutlookInjectionAnchor } from "./detectThread.js";

try {
  runContentScript({
    detectThread: () => detectOutlookThread(),
    findInjectionAnchor: () => findOutlookInjectionAnchor(),
  });
} catch (e) {
  // A content script that throws on load must still leave OWA usable.
  console.debug("[amarnai] Outlook content script failed to start:", e);
}
