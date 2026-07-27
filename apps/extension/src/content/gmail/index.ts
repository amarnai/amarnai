// Gmail content-script entrypoint. Injected at document_idle on
// https://mail.google.com/*; see manifest.config.ts.
import { runContentScript } from "../core/runner.js";
import { detectGmailThread, findGmailInjectionAnchor } from "./detectThread.js";

try {
  runContentScript({
    detectThread: () => detectGmailThread(),
    findInjectionAnchor: () => findGmailInjectionAnchor(),
  });
} catch (e) {
  // A content script that throws on load must still leave Gmail usable.
  console.debug("[amarnai] Gmail content script failed to start:", e);
}
