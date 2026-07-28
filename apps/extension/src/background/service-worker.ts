// Minimal background script (MV3 service worker on Chrome, event page on Firefox).
//
// It holds NO long-lived state or connections: both browsers suspend it when
// idle (Chrome kills the service worker after ~30s; Firefox suspends the event
// page), and streaming fetches do not keep it alive. So the side-panel/sidebar
// page owns the SSE stream and all data fetching. The script's only jobs are to
// open the panel when the toolbar icon is clicked, open the welcome tab on
// first install, and answer the mail-page content scripts' requests — thread
// summaries and reply drafts (they cannot call the API themselves; see
// content/core/messaging.ts). Listeners are
// registered synchronously at top level, as event pages require — an event page
// is woken BY the event, so a listener added later would miss it.
import { ext } from "../platform/ext";
import { registerThreadSummaryHandler } from "./summaryHandler";
import { registerGenerateDraftHandler } from "./draftHandler";
import { registerOpenPanelHandler } from "./openPanelHandler";
import { registerPageWorldHandler } from "./pageWorldHandler";
import { registerInstallHandler } from "./installHandler";

// Each handler discriminates on its own message type and bails on anything else,
// so registration order carries no meaning.
registerThreadSummaryHandler();
registerGenerateDraftHandler();
registerOpenPanelHandler();
registerPageWorldHandler();
registerInstallHandler();

if (ext.sidePanel) {
  // Chrome: bind the toolbar icon to the side panel. Idempotent, re-runs on every
  // service-worker wake, which is cheap.
  ext.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[amarnai] setPanelBehavior:", err));
} else if (ext.sidebarAction) {
  // Firefox: there is no openPanelOnActionClick equivalent. sidebarAction.toggle()
  // must run inside a user-input handler; action.onClicked qualifies.
  const sidebar = ext.sidebarAction;
  ext.action.onClicked.addListener(() => void sidebar.toggle());
}
