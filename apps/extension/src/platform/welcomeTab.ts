import { ext } from "./ext";

// The welcome tab's id, published by the page itself and read once by the panel.
// storage.session (not local) is deliberate: tab ids are unique only within a
// browser session, so a value that outlived a restart could name an unrelated
// tab. Session storage is emptied for us at exactly the right moment.
const KEY = "amarnai.welcomeTabId";

function welcomeUrl(): string {
  return ext.runtime.getURL("welcome.html");
}

/**
 * Lets the welcome page be found later by the panel, which wants to navigate it
 * to the user's mailbox once sign-in is done rather than leave a spent
 * onboarding page behind and open a second tab beside it.
 *
 * The page publishes its own id (`tabs.getCurrent` needs no permission and can
 * only ever return the caller's tab) and withdraws it on unload, so the record
 * tracks the page's life rather than merely its creation.
 */
export function registerWelcomeTab(): void {
  void ext.tabs
    .getCurrent?.()
    .then((tab) => {
      if (tab?.id == null) return;
      return ext.storage.session.set({ [KEY]: tab.id });
    })
    .catch(() => {});

  // Fires on navigation away and on close, unlike unload. Best-effort: a write
  // during teardown may not land, which is why the read side re-checks the tab.
  window.addEventListener("pagehide", () => {
    void ext.storage.session.remove(KEY).catch(() => {});
  });
}

/**
 * The welcome tab's id if it is still showing the welcome page, consuming the
 * record either way — this is a one-shot handoff, and a second caller must not
 * be handed a tab that has since become something the user cares about.
 *
 * Returns null when there is no welcome tab, which is the common case: only a
 * user who installed and signed in without closing it has one.
 */
export async function takeWelcomeTabId(): Promise<number | null> {
  try {
    const out = await ext.storage.session.get(KEY);
    const id = out[KEY] as number | undefined;
    if (id == null) return null;
    await ext.storage.session.remove(KEY);

    // The tab may have been closed, or navigated somewhere the pagehide write
    // failed to record. `url` is only populated when the browser exposes it; we
    // insist on a match when it is there and trust the session record when not.
    const tab = await ext.tabs.get(id);
    if (tab.url && !tab.url.startsWith(welcomeUrl())) return null;
    return tab.id ?? null;
  } catch {
    return null;
  }
}
