// Gmail content-script entrypoint. Injected at document_idle on
// https://mail.google.com/*; see manifest.config.ts.
import { runContentScript } from "../core/runner.js";
import { detectGmailThread, findGmailInjectionAnchor, findAccountEmail } from "./detectThread.js";
import { startReplyButton } from "./replyButtonHost.js";

try {
  runContentScript({
    detectThread: () => detectGmailThread(),
    findInjectionAnchor: () => findGmailInjectionAnchor(),
    // Gmail's message rows start past an avatar gutter; without this the card
    // hangs left of the conversation it annotates.
    gutterLeft: "12px",
  });
} catch (e) {
  // A content script that throws on load must still leave Gmail usable.
  console.debug("[amarnai] Gmail content script failed to start:", e);
}

// Independent of the summary widget above: the button lives in Gmail's compose,
// which InboxSDK surfaces on its own schedule, so it does not go through the
// runner's single-widget/one-anchor machinery. Either feature can fail without
// taking the other down. The failure is reported through .catch, NOT a
// try/catch — startReplyButton is async (InboxSDK.load), and a rejection would
// sail straight past a synchronous catch block and vanish.
startReplyButton({ getAccountEmail: () => findAccountEmail() }).catch(
  (e: unknown) => {
    console.warn("[amarnai] Amarnai Reply button failed to start:", e);
  },
);
