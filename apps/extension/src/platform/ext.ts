// Cross-browser extension-API namespace.
//
// Firefox implements the promise-based `browser` namespace natively; Chrome only
// exposes `chrome`. Every extension-API call site imports `ext` so the code has a
// single, promise-based surface on both browsers. Typed as `typeof chrome` (so
// @types/chrome keeps working) with the two APIs that differ made optional:
// `sidePanel` is Chrome-only, `sidebarAction` is Firefox-only.
//
// No webextension-polyfill: there are only a handful of call sites, Firefox's
// `browser.*` is already promisified, and this keeps the vitest `globalThis.chrome`
// stub working unchanged (jsdom has no `browser` global, so `ext` falls back to it).
interface SidebarAction {
  toggle(): Promise<void>;
  open(): Promise<void>;
}

export type ExtApi = Omit<typeof chrome, "sidePanel"> & {
  // Absent on Firefox — feature-detect before use.
  sidePanel?: typeof chrome.sidePanel;
  // Absent on Chrome — feature-detect before use.
  sidebarAction?: SidebarAction;
};

export const ext: ExtApi =
  (globalThis as unknown as { browser?: ExtApi }).browser ?? (chrome as ExtApi);

// Which browser this build is running in, feature-detected the same way the
// service worker distinguishes side panel (Chrome) from sidebar (Firefox).
// Defaults to CHROME when neither surface is present (e.g. the vitest stub).
export function currentBrowser(): "CHROME" | "FIREFOX" {
  return ext.sidebarAction && !ext.sidePanel ? "FIREFOX" : "CHROME";
}

// This extension's own version, from the manifest generated at build time.
export function extensionVersion(): string {
  return ext.runtime.getManifest().version;
}
