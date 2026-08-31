// Opt-in tracing for the injected summary widget.
//
// The widget deliberately renders NOTHING on every failure path (signed out,
// mailbox not connected, thread not synced, no anchor, API down) so it can never
// put an Aziru error in someone's mailbox. That is right for users and awful
// for debugging: "no card appeared" has a dozen indistinguishable causes.
//
// Enable from the mail page's devtools console:
//   localStorage.setItem("amarnai.debug", "1")   // then reload the tab
//   localStorage.removeItem("amarnai.debug")     // turn it back off
//
// Reads the page's localStorage (content scripts share it with the host page)
// because the tab console is where someone debugging this actually is. The value
// is read once at script start, so toggling it needs a reload.

let enabled = false;

try {
  enabled = window.localStorage.getItem("amarnai.debug") === "1";
} catch {
  // Storage can be blocked by page policy; tracing off is the safe default.
  enabled = false;
}

export function debugEnabled(): boolean {
  return enabled;
}

export function debugLog(...args: unknown[]): void {
  if (!enabled) return;
  console.log("[aziru]", ...args);
}
