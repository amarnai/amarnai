import { InjectionDisabledError } from "@amarnai/api-client";
import { ext } from "../platform/ext.js";
import { extensionTokenStore } from "../auth/tokenStore.js";
import {
  isGenerateDraftRequest,
  type GenerateDraftRequest,
  type GenerateDraftResponse,
} from "../content/core/messaging.js";
import { getInjectionClient, resolveWorkspaceForAccount } from "./summaryHandler.js";

// Background half of the "Amarnai Reply" button. Sibling of summaryHandler: same
// transport, same account→workspace resolution, same never-throws contract.
//
// One deliberate difference. The summary widget never polls — a mail page is not
// a place to spin, and the next thread open picks up the cached result. The
// button does poll, because the user clicked it and is watching: a 202 means
// someone else's request is already paying for this draft, and abandoning it
// would strand the click with nothing to show.

/** How long to keep waiting on a concurrent generation before giving up. */
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Answer one content-script request. Never throws. */
export async function handleGenerateDraftRequest(
  request: GenerateDraftRequest,
): Promise<GenerateDraftResponse> {
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

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    let result;
    try {
      result = await api.generateDraftByProviderThread(workspaceId, request.providerThreadId, {
        ...(request.refKind ? { refKind: request.refKind } : {}),
      });
    } catch (e) {
      // A refusal, not a failure: the workspace turned the button off. Told apart
      // from an error so the content script can remove the button instead of
      // offering a retry that will never succeed.
      if (e instanceof InjectionDisabledError) {
        return { ok: false, reason: "injectionDisabled" };
      }
      // A 404 (thread never synced into Amarnai) lands here alongside real
      // failures. They differ to the user — "not in Amarnai yet" vs "try again" —
      // so the 404 keeps its own reason and everything else is an error.
      const message = e instanceof Error ? e.message : "";
      return { ok: false, reason: /not found/i.test(message) ? "noThread" : "error" };
    }

    if ("quotaExceeded" in result) {
      return {
        ok: true,
        result: {
          kind: "quota",
          used: result.used,
          limit: result.limit,
          resetsAt: result.resetsAt,
        },
      };
    }
    if ("notClassified" in result) {
      return { ok: true, result: { kind: "notSorted" } };
    }
    if ("draft" in result) {
      return {
        ok: true,
        result: { kind: "draft", draftId: result.draft.id, body: result.draft.body },
      };
    }

    // 202: a generation for this thread is already in flight. Wait for it rather
    // than starting a second one, which would double-charge the user's quota.
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      return { ok: false, reason: "error" };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Register the listener. Must be called synchronously at background top level:
 * an event page is woken BY the message, so a listener added inside a promise
 * would miss it.
 */
export function registerGenerateDraftHandler(): void {
  ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isGenerateDraftRequest(message)) return false;
    handleGenerateDraftRequest(message)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: "error" } satisfies GenerateDraftResponse));
    // true = the response is asynchronous; keep the message channel open.
    return true;
  });
}
