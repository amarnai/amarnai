import { ext } from "../platform/ext.js";

// InboxSDK's page-world bootstrap.
//
// @inboxsdk/core runs in the content script's isolated world, but part of it
// must run in Gmail's own JS world (to see Gmail's XHRs and compose internals).
// In MV3 a content script cannot cross that boundary itself: the SDK sends this
// exact message and the background injects pageWorld.js into the MAIN world on
// its behalf. Without this handler, InboxSDK.load() waits forever for a
// handshake that never comes — the failure mode is silence, not an error, which
// is why this file exists as a named piece rather than an inline listener.
//
// The message type string is the SDK's, not ours; it must match verbatim.
const INJECT_PAGE_WORLD_MESSAGE = "inboxsdk__injectPageWorld";

export function isInjectPageWorldRequest(msg: unknown): boolean {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>)["type"] === INJECT_PAGE_WORLD_MESSAGE
  );
}

/**
 * Inject pageWorld.js into the sender's tab. Answers `true` on success — the
 * SDK's callback treats anything falsy as "not injected" and throws its
 * MV3-misconfiguration error into the content script.
 *
 * Requires the `scripting` permission plus the mail-host grant the manifest
 * already carries; `world: "MAIN"` is what actually crosses the boundary.
 * Firefox supports it from 128, which is the build's strict_min_version.
 */
export async function handleInjectPageWorld(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined || !ext.scripting) return false;
  try {
    await ext.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["pageWorld.js"],
    });
    return true;
  } catch (e) {
    // warn, not debug: this is the failure that makes the reply button silently
    // absent, and it surfaces in the background console where debug is hidden.
    console.warn("[amarnai] pageWorld injection failed:", e);
    return false;
  }
}

/**
 * Register the listener. Must be called synchronously at background top level:
 * an event page is woken BY the message, so a listener added inside a promise
 * would miss it.
 */
export function registerPageWorldHandler(): void {
  ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isInjectPageWorldRequest(message)) return false;
    handleInjectPageWorld(sender.tab?.id)
      .then(sendResponse)
      .catch(() => sendResponse(false));
    // true = the response is asynchronous; keep the message channel open.
    return true;
  });
}
