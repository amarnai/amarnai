import { InjectionDisabledError } from "@aziru/api-client";
import { ext } from "../platform/ext.js";
import { extensionTokenStore } from "../auth/tokenStore.js";
import {
  isCommentMetaRequest,
  type CommentMetaRequest,
  type CommentMetaResponse,
} from "../content/core/messaging.js";
import { getInjectionClient, resolveWorkspaceForAccount } from "./summaryHandler.js";

// Background half of the comment-bubble badge on the injected summary card.
// Mirrors summaryHandler: same shared client (one refresh single-flight), same
// session-cached mailbox→workspace resolution, and the same discipline that
// every failure maps to a reason the content script renders as nothing.

/** Answer one content-script request. Never throws. */
export async function handleCommentMetaRequest(
  request: CommentMetaRequest,
): Promise<CommentMetaResponse> {
  const tokens = await extensionTokenStore.get();
  if (!tokens) return { ok: false, reason: "signedOut" };

  const api = getInjectionClient();

  let workspaceId: string | null;
  try {
    workspaceId = await resolveWorkspaceForAccount(api, request.accountEmail);
  } catch {
    return { ok: false, reason: "error" };
  }
  if (!workspaceId) return { ok: false, reason: "noWorkspace" };

  try {
    const meta = await api.providerThreadCommentsMeta(workspaceId, request.providerThreadId);
    // Null = the thread was never synced into Aziru; no bubble.
    if (!meta) return { ok: false, reason: "noThread" };
    return { ok: true, meta: { total: meta.total, unread: meta.unread } };
  } catch (e) {
    // The workspace has switched the injected panel off — the bubble's target
    // is gone, so there is nothing to badge. Permanent for the session, like
    // the summary's own latch.
    if (e instanceof InjectionDisabledError) return { ok: false, reason: "injectionDisabled" };
    return { ok: false, reason: "noThread" };
  }
}

/**
 * Register the listener. Must be called synchronously at background top level:
 * an event page is woken BY the message, so a listener added inside a promise
 * would miss it.
 */
export function registerCommentMetaHandler(): void {
  ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isCommentMetaRequest(message)) return false;
    handleCommentMetaRequest(message)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: "error" } satisfies CommentMetaResponse));
    // true = the response is asynchronous; keep the message channel open.
    return true;
  });
}
