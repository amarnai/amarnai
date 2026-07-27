import {
  makeApiClient,
  makeBearerTransport,
  InjectionDisabledError,
  type ApiClient,
} from "@amarnai/api-client";
import { ext } from "../platform/ext.js";
import { extensionTokenStore } from "../auth/tokenStore.js";
import { API_BASE_URL } from "../config.js";
import {
  isThreadSummaryRequest,
  type ThreadSummaryRequest,
  type ThreadSummaryResponse,
} from "../content/core/messaging.js";

// Background half of the native-injection protocol.
//
// The content script cannot call the API itself (page-origin CORS, and a second
// refresh single-flight would race the panel's). So it sends one message and the
// background does the work with the same bearer transport the panel uses.

const WORKSPACE_CACHE_KEY = "amarnai.injectWorkspaceByAccount";

/** Built lazily: the background wakes for many events that need no API client. */
let client: ApiClient | null = null;

function getClient(): ApiClient {
  client ??= makeApiClient(
    makeBearerTransport({
      baseUrl: API_BASE_URL,
      tokenStore: extensionTokenStore,
      // No onAuthFailure sign-out here: the panel owns session state. A failed
      // refresh simply means this request answers "signedOut" and the content
      // script renders nothing.
    }),
  );
  return client;
}

/** Reset the memoized client (used by tests and after a sign-out). */
export function resetSummaryClient(): void {
  client = null;
}

type WorkspaceCache = Record<string, string>;

async function readWorkspaceCache(): Promise<WorkspaceCache> {
  // storage.session is per-browser-session and never written to disk — the right
  // lifetime for a mapping that must not go stale across a mailbox reconnect.
  const area = ext.storage.session ?? ext.storage.local;
  try {
    const out = await area.get(WORKSPACE_CACHE_KEY);
    return (out[WORKSPACE_CACHE_KEY] as WorkspaceCache | undefined) ?? {};
  } catch {
    return {};
  }
}

async function writeWorkspaceCache(cache: WorkspaceCache): Promise<void> {
  const area = ext.storage.session ?? ext.storage.local;
  try {
    await area.set({ [WORKSPACE_CACHE_KEY]: cache });
  } catch {
    // A cache write failure just costs an extra lookup next time.
  }
}

/**
 * Map the mailbox visible in the mail UI to the workspace that has it connected.
 * Returns null when the signed-in user has no workspace for that address — which
 * is the normal case under multi-login, and means "render nothing".
 */
export async function resolveWorkspaceForAccount(
  api: ApiClient,
  accountEmail: string,
): Promise<string | null> {
  const key = accountEmail.toLowerCase();
  const cache = await readWorkspaceCache();
  const cached = cache[key];
  if (cached) return cached;

  const workspaces = await api.workspaces();
  for (const workspace of workspaces) {
    const connection = await api.gmailConnection(workspace.id);
    if (connection?.gmailAddress?.toLowerCase() === key) {
      await writeWorkspaceCache({ ...cache, [key]: workspace.id });
      return workspace.id;
    }
  }
  return null;
}

/** Answer one content-script request. Never throws. */
export async function handleThreadSummaryRequest(
  request: ThreadSummaryRequest,
): Promise<ThreadSummaryResponse> {
  const tokens = await extensionTokenStore.get();
  if (!tokens) return { ok: false, reason: "signedOut" };

  const api = getClient();

  let workspaceId: string | null;
  try {
    workspaceId = await resolveWorkspaceForAccount(api, request.accountEmail);
  } catch {
    return { ok: false, reason: "error" };
  }
  if (!workspaceId) return { ok: false, reason: "noWorkspace" };

  try {
    const result = await api.providerThreadSummary(
      workspaceId,
      request.providerThreadId,
      request.force ? { force: true } : {},
    );
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
    if ("generating" in result) {
      // Someone else is already paying for this one. The content script has no
      // polling loop (a mail page is not a place to spin); the next thread open
      // picks up the cached result.
      return { ok: false, reason: "error" };
    }
    if (result.kind === "snippet") return { ok: true, result: { kind: "snippet" } };
    if (result.summary.format === "BULLETS") {
      return { ok: true, result: { kind: "bullets", bullets: result.summary.bullets } };
    }
    return { ok: true, result: { kind: "summary", text: result.summary.text } };
  } catch (e) {
    // The workspace has switched the card off. Told apart from the rest because
    // it is permanent for this session: the content script latches on it and
    // stops requesting, rather than paying a roundtrip per thread open.
    if (e instanceof InjectionDisabledError) return { ok: false, reason: "injectionDisabled" };
    // A 404 (thread never synced into Amarnai) lands here alongside real errors.
    // Both render nothing, so they need not be told apart.
    return { ok: false, reason: "noThread" };
  }
}

/**
 * Register the listener. Must be called synchronously at background top level:
 * an event page is woken BY the message, so a listener added inside a promise
 * would miss it.
 */
export function registerThreadSummaryHandler(): void {
  ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isThreadSummaryRequest(message)) return false;
    handleThreadSummaryRequest(message)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: "error" } satisfies ThreadSummaryResponse));
    // true = the response is asynchronous; keep the message channel open.
    return true;
  });
}
