// Minimal MV3 service worker.
//
// MV3 service workers are terminated after ~30s idle and streaming fetches do
// not keep them alive, so the worker holds NO long-lived state or connections:
// the side-panel page owns the SSE stream and all data fetching. The worker's
// only job is to open the side panel when the toolbar icon is clicked. This
// re-runs on every wake, which is idempotent and cheap.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[amarnai] setPanelBehavior:", err));
