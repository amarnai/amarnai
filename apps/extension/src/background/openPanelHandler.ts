import { ext } from "../platform/ext.js";
import { OPEN_PANEL_MESSAGE, isOpenPanelRequest } from "../content/core/messaging.js";

// Opens Amarnai's own panel on request from a mail page.
//
// Sign-in never happens inside the injected UI: an OAuth flow started from
// within a third-party page is neither reliable nor something a user should be
// asked to trust. The button in Gmail therefore does not authenticate — it sends
// this message and the panel takes over.

/**
 * Chrome requires sidePanel.open() to be called in response to a user gesture.
 * The gesture originates from a click in the content script, and whether it
 * survives the message hop is not guaranteed across Chrome versions — so a
 * failure here is expected rather than exceptional, and the user falls back to
 * the toolbar icon. Nothing is retried and nothing is thrown onto the page.
 */
async function openPanel(tabId: number | undefined): Promise<void> {
  try {
    if (ext.sidePanel && tabId !== undefined) {
      await ext.sidePanel.open({ tabId });
      return;
    }
    // Firefox: the sidebar has no per-tab open.
    await ext.sidebarAction?.open();
  } catch (e) {
    console.debug(`[amarnai] could not open the panel for ${OPEN_PANEL_MESSAGE}:`, e);
  }
}

/**
 * Register the listener. Must be called synchronously at background top level:
 * an event page is woken BY the message, so a listener added inside a promise
 * would miss it.
 */
export function registerOpenPanelHandler(): void {
  ext.runtime.onMessage.addListener((message, sender) => {
    if (!isOpenPanelRequest(message)) return false;
    void openPanel(sender.tab?.id);
    // No response: the sender is fire-and-forget.
    return false;
  });
}
