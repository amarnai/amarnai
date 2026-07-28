import { ext } from "../platform/ext.js";

/**
 * Opens the welcome tab the first time the extension is installed.
 *
 * Only on `install`: an `update` fires on every store release, and reopening a
 * tab under someone who did not ask for it is not something a version bump
 * should do. The page is bundled with the extension (welcome.html, a second
 * Vite entry), so it needs no host permission and no manifest declaration —
 * extension pages opened in a tab are not web-accessible resources.
 */
export function registerInstallHandler(): void {
  ext.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "install") return;
    void ext.tabs
      .create({ url: ext.runtime.getURL("welcome.html") })
      // A browser that refuses the tab (or a profile closing at that instant)
      // is not worth surfacing: the extension is installed either way.
      .catch(() => {});
  });
}
