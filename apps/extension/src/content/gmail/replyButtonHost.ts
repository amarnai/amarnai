import * as InboxSDK from "@inboxsdk/core";
import { INBOXSDK_APP_ID } from "../../config.js";
import { GENERATE_DRAFT_MESSAGE, type GenerateDraftResponse } from "../core/messaging.js";
import { debugLog } from "../core/debug.js";
import { attachReplyButton, type ComposeViewLike } from "./replyButton.js";
import { consumeArmedReply } from "./armedReply.js";
import { disableReplyEntryPoints, startReplyEntryPoints } from "./replyEntryPoints.js";

// Everything that touches InboxSDK or the extension runtime, kept apart from
// replyButton.ts so the state machine there stays testable without either.

const ICON_PATH = "reply-button-icon.svg";

/**
 * InboxSDK.load() has a failure mode of never settling: it waits for the
 * pageWorld.js handshake, and if that injection quietly fails there is no
 * rejection to catch — just eternal silence, which reads as "the button does
 * not exist". This watchdog turns that state into one visible warning. Plain
 * console.warn, not debugLog: an install where the button cannot load should
 * say so without anyone having to know the debug flag exists.
 */
const LOAD_WATCHDOG_MS = 20_000;

/** Read a ComposeView accessor that may throw (getThreadID does, for some composes). */
function tryRead<T>(read: () => T): T | "threw" {
  try {
    return read();
  } catch {
    return "threw";
  }
}

/** Ask the background for a draft. Resolves to an outcome; never rejects. */
function requestDraft(
  accountEmail: string,
  providerThreadId: string,
): Promise<GenerateDraftResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: GENERATE_DRAFT_MESSAGE, accountEmail, providerThreadId },
        (response: GenerateDraftResponse | undefined) => {
          // A dead channel sets lastError and yields undefined; reading it here
          // also stops Chrome logging an unchecked-error warning onto the page.
          if (chrome.runtime.lastError || !response) {
            resolve({ ok: false, reason: "error" });
            return;
          }
          resolve(response);
        },
      );
    } catch {
      resolve({ ok: false, reason: "error" });
    }
  });
}

/**
 * Load InboxSDK and put the button in every reply compose Gmail opens.
 *
 * Resolves to a teardown. A missing app id is not an error: a build without one
 * simply ships no button, which is how self-hosters who have not registered with
 * InboxSDK run the extension.
 */
export async function startReplyButton(deps: {
  getAccountEmail: () => string | null;
}): Promise<() => void> {
  if (!INBOXSDK_APP_ID) {
    debugLog("reply button: no VITE_INBOXSDK_APP_ID in this build — button disabled");
    return () => {};
  }

  debugLog("reply button: loading InboxSDK…");
  const watchdog = setTimeout(() => {
    console.warn(
      "[amarnai] Amarnai Reply: InboxSDK did not finish loading after " +
        `${LOAD_WATCHDOG_MS / 1000}s. This usually means pageWorld.js was not ` +
        "injected — check the extension's background console (service worker) " +
        "and that the manifest carries the scripting permission.",
    );
  }, LOAD_WATCHDOG_MS);

  let sdk;
  try {
    sdk = await InboxSDK.load(2, INBOXSDK_APP_ID);
  } finally {
    clearTimeout(watchdog);
  }
  debugLog("reply button: InboxSDK ready — watching for reply composes");

  const iconUrl = chrome.runtime.getURL(ICON_PATH);
  const detachers = new Set<() => void>();

  const unregister = sdk.Compose.registerComposeViewHandler((composeView) => {
    const view = composeView as unknown as ComposeViewLike;
    const threadId = tryRead(() => view.getThreadID());
    // An armed compose was opened BY an "Amarnai Reply" entry point: the user
    // already asked for a draft, so generation starts without a second click.
    const autoStart = consumeArmedReply(threadId === "threw" ? null : threadId || null);
    debugLog(
      "reply button: compose opened —",
      `reply=${String(tryRead(() => view.isReply()))}`,
      `inline=${String(tryRead(() => view.isInlineReplyForm()))}`,
      `forward=${String(tryRead(() => view.isForward()))}`,
      `thread=${String(threadId)}`,
      `autoStart=${String(autoStart)}`,
    );
    const detach = attachReplyButton(
      view,
      {
        getAccountEmail: deps.getAccountEmail,
        requestDraft,
        openPanel: () => {
          // Sign-in happens in the extension's own panel: an OAuth flow started
          // from inside a third-party page is neither reliable nor trustworthy.
          void chrome.runtime.sendMessage({ type: "amarnai:openPanel" });
        },
        onDisabled: () => disableReplyEntryPoints(),
        iconUrl,
      },
      { autoStart },
    );
    detachers.add(detach);
  });

  // The entry points exist to open composes the button above will draft into,
  // so they start only once the SDK — and therefore that button — is ready.
  const stopEntryPoints = startReplyEntryPoints();

  return () => {
    unregister();
    stopEntryPoints();
    for (const detach of detachers) detach();
    detachers.clear();
  };
}
