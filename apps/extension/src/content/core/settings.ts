import { ext } from "../../platform/ext.js";

// Runtime kill-switch for the native injection, toggled from the panel's
// settings. Separate from the build-time VITE_DISABLE_NATIVE_INJECTION switch:
// that one omits content_scripts from the manifest entirely (for a build that
// must not touch mail pages at all), this one lets a user who has the feature
// installed turn it off without uninstalling.

export const INJECT_SETTING_KEY = "amarnai.injectNativeSummaries";

/** Default on: the feature is the point of shipping the content scripts. */
export async function isInjectionEnabled(): Promise<boolean> {
  try {
    const out = await ext.storage.local.get(INJECT_SETTING_KEY);
    return out[INJECT_SETTING_KEY] !== false;
  } catch {
    return true;
  }
}

export async function setInjectionEnabled(enabled: boolean): Promise<void> {
  await ext.storage.local.set({ [INJECT_SETTING_KEY]: enabled });
}

/**
 * Subscribe to changes so a content script can remove its widget the moment the
 * user turns the feature off, without a page reload. Returns an unsubscribe fn.
 */
export function onInjectionEnabledChanged(handler: (enabled: boolean) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== "local") return;
    const change = changes[INJECT_SETTING_KEY];
    if (!change) return;
    handler(change.newValue !== false);
  };
  ext.storage.onChanged.addListener(listener);
  return () => ext.storage.onChanged.removeListener(listener);
}
