import * as InboxSDK from "@inboxsdk/core";
import { INBOXSDK_APP_ID } from "../../config.js";
import { debugLog } from "../core/debug.js";

// One InboxSDK per page, shared by everything that needs it.
//
// Two features load the SDK now — the reply button (Compose) and the panel
// (Global.addSidebarContentPanel) — and calling InboxSDK.load twice on one page
// means two page-world handshakes and two sets of handlers for the same Gmail
// events. Both callers go through here instead, and the second one gets the
// first one's promise.

/**
 * InboxSDK.load() has a failure mode of never settling: it waits for the
 * pageWorld.js handshake, and if that injection quietly fails there is no
 * rejection to catch — just eternal silence, which reads as "the feature does
 * not exist". This watchdog turns that state into one visible warning. Plain
 * console.warn, not debugLog: an install where the SDK cannot load should say so
 * without anyone having to know the debug flag exists.
 */
const LOAD_WATCHDOG_MS = 20_000;

export type LoadedInboxSDK = Awaited<ReturnType<typeof InboxSDK.load>>;

let pending: Promise<LoadedInboxSDK> | null = null;

/**
 * The page's InboxSDK instance, loaded on first call.
 *
 * Rejects when the build carries no app id: a self-hoster who has not registered
 * with InboxSDK runs the extension with neither the button nor the panel, and
 * each caller decides for itself how quietly to give up.
 */
export function loadInboxSDK(): Promise<LoadedInboxSDK> {
  if (pending) return pending;

  if (!INBOXSDK_APP_ID) {
    return Promise.reject(new Error("no-inboxsdk-app-id"));
  }

  debugLog("inboxsdk: loading…");
  const watchdog = setTimeout(() => {
    console.warn(
      "[aziru] InboxSDK did not finish loading after " +
        `${LOAD_WATCHDOG_MS / 1000}s. This usually means pageWorld.js was not ` +
        "injected — check the extension's background console (service worker) " +
        "and that the manifest carries the scripting permission.",
    );
  }, LOAD_WATCHDOG_MS);

  pending = InboxSDK.load(2, INBOXSDK_APP_ID)
    .then((sdk) => {
      debugLog("inboxsdk: ready");
      return sdk;
    })
    .catch((e: unknown) => {
      // A rejected load is not memoized: the next feature to ask gets a fresh
      // attempt rather than inheriting a failure it had no part in.
      pending = null;
      throw e;
    })
    .finally(() => clearTimeout(watchdog));

  return pending;
}

/** Whether this build can load the SDK at all. */
export function hasInboxSdkAppId(): boolean {
  return !!INBOXSDK_APP_ID;
}

/** Test seam: drop the memoized instance between cases. */
export function resetInboxSDK(): void {
  pending = null;
}
