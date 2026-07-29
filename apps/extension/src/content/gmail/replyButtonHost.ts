import { requestDraftFromBackground } from "../core/draftRequest.js";
import { debugLog } from "../core/debug.js";
import { attachReplyButton, type ComposeViewLike } from "./replyButton.js";
import { consumeArmedReply } from "./armedReply.js";
import { disableReplyEntryPoints, startReplyEntryPoints } from "./replyEntryPoints.js";
import { hasInboxSdkAppId, loadInboxSDK } from "./inboxSdk.js";

// Everything that touches InboxSDK or the extension runtime, kept apart from
// replyButton.ts so the state machine there stays testable without either.

const ICON_PATH = "reply-button-icon.svg";

/** Read a ComposeView accessor that may throw (getThreadID does, for some composes). */
function tryRead<T>(read: () => T): T | "threw" {
  try {
    return read();
  } catch {
    return "threw";
  }
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
  if (!hasInboxSdkAppId()) {
    debugLog("reply button: no VITE_INBOXSDK_APP_ID in this build — button disabled");
    return () => {};
  }

  // Shared with the injected panel: one load per page, one page-world handshake.
  const sdk = await loadInboxSDK();
  debugLog("reply button: InboxSDK ready — watching for reply composes");

  const iconUrl = chrome.runtime.getURL(ICON_PATH);
  const detachers = new Set<() => void>();

  const unregister = sdk.Compose.registerComposeViewHandler((composeView) => {
    const view = composeView as unknown as ComposeViewLike;
    const threadId = tryRead(() => view.getThreadID());
    // An armed compose was opened BY an "Amarnai Reply" entry point or by the
    // injected panel: the user already asked for a draft, so it lands without a
    // second click — inserted directly when the opener brought one along.
    const armed = consumeArmedReply(threadId === "threw" ? null : threadId || null);
    debugLog(
      "reply button: compose opened —",
      `reply=${String(tryRead(() => view.isReply()))}`,
      `inline=${String(tryRead(() => view.isInlineReplyForm()))}`,
      `forward=${String(tryRead(() => view.isForward()))}`,
      `thread=${String(threadId)}`,
      `armed=${String(!!armed)}`,
      `preset=${String(!!armed?.html)}`,
    );
    const detach = attachReplyButton(
      view,
      {
        getAccountEmail: deps.getAccountEmail,
        requestDraft: requestDraftFromBackground,
        openPanel: () => {
          // Sign-in happens in the extension's own panel: an OAuth flow started
          // from inside a third-party page is neither reliable nor trustworthy.
          void chrome.runtime.sendMessage({ type: "amarnai:openPanel" });
        },
        onDisabled: () => disableReplyEntryPoints(),
        iconUrl,
      },
      {
        autoStart: !!armed,
        ...(armed?.html ? { presetHtml: armed.html } : {}),
      },
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
