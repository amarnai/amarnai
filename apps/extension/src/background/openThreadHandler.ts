import { ext } from "../platform/ext.js";
import { buildGmailThreadHashUrl } from "../gmail/gmailUrl.js";
import { isOpenMailThreadRequest } from "../content/core/messaging.js";

// Opens a conversation in the mail tab the injected panel is embedded in.
//
// The panel's queue lists threads that are waiting on the user; clicking one has
// to move the mail client to it, not just the panel. Doing that from here rather
// than from the content script is deliberate: the background knows which tab the
// message came from (`sender.tab`) and can navigate it with the browser's own
// API, which is exactly what Amarnai's side panel does when a row is clicked
// there. The content script's alternative — assigning `location` inside Gmail —
// depends on the panel's postMessage channel and on the page reacting to a write
// we cannot observe.
//
// Gmail only, because the injected panel is Gmail only: the Outlook pane is an
// Office add-in with no tab of ours to navigate, and its queue links out instead.

const GMAIL_URL_PREFIX = "https://mail.google.com/";

/**
 * A hash-only change, so Gmail routes it client-side with no reload and the tab
 * keeps whichever account (`/u/<n>/`) it is already on. Failures are logged and
 * dropped: nothing is waiting on this, and a mail tab must never sprout an
 * Amarnai error because a navigation was refused.
 */
async function openThread(
  tabId: number | undefined,
  tabUrl: string | undefined,
  providerThreadId: string,
): Promise<void> {
  if (tabId === undefined || !tabUrl?.startsWith(GMAIL_URL_PREFIX)) {
    console.debug("[amarnai] openMailThread: no Gmail tab to navigate", { tabId, tabUrl });
    return;
  }
  try {
    await ext.tabs.update(tabId, { url: buildGmailThreadHashUrl(tabUrl, providerThreadId) });
  } catch (e) {
    console.debug("[amarnai] openMailThread: could not navigate the tab:", e);
  }
}

/**
 * Register the listener. Must be called synchronously at background top level:
 * an event page is woken BY the message, so a listener added inside a promise
 * would miss it.
 */
export function registerOpenMailThreadHandler(): void {
  ext.runtime.onMessage.addListener((message, sender) => {
    if (!isOpenMailThreadRequest(message)) return false;
    void openThread(sender.tab?.id, sender.tab?.url, message.providerThreadId);
    // No response: the sender is fire-and-forget.
    return false;
  });
}
