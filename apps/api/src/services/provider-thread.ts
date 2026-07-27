import { db } from "@amarnai/db";

// Shared by every route the native Gmail/Outlook injection calls. Those routes
// are addressed by the provider's own thread id (the only id a mail page knows),
// while everything inside Amarnai is keyed by our internal thread id. Both the
// alphabet fix and the account fan-out live here so the two never drift apart:
// a thread that resolves for the summary must resolve for the reply draft.

/**
 * OWA's DOM (`data-convid`) carries the EWS flavor of the conversation id:
 * same bytes as the Graph `conversationId` we store, but the EWS base64
 * alphabet (`+`, `/`). Graph's URL-safe translation is NOT standard base64url:
 * it swaps `+`→`_` and `/`→`-` (verified against a live mailbox, and matching
 * Microsoft's documented EWS↔REST id conversion). Map onto the stored alphabet
 * so the native content scripts resolve. Idempotent for ids already in Graph
 * form (they never contain `+` or `/`), and a no-op for Gmail's hex thread ids.
 */
export function normalizeProviderThreadId(id: string): string {
  return id.replace(/\+/g, "_").replace(/\//g, "-");
}

/**
 * Map a provider thread id to our internal thread id, searching every email
 * account in the workspace via the (emailAccountId, providerThreadId) unique
 * key. Returns null when the workspace has no accounts or the thread was never
 * synced — callers turn that into a 404, which the content scripts render as
 * nothing at all.
 */
export async function resolveProviderThreadId(
  workspaceId: string,
  providerThreadId: string,
): Promise<string | null> {
  const accounts = await db.emailAccount.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  if (accounts.length === 0) return null;

  const thread = await db.emailThread.findFirst({
    where: {
      emailAccountId: { in: accounts.map((a) => a.id) },
      providerThreadId: normalizeProviderThreadId(providerThreadId),
    },
    select: { id: true },
  });
  return thread?.id ?? null;
}

/**
 * Whether this workspace still permits a given native-injection surface.
 * A missing settings row means defaults, and both defaults are on.
 *
 * Enforced server-side rather than in the content script because the extension
 * is the half we do not control: an old build, or one a user never updates, must
 * stop injecting the moment the workspace turns the setting off. Only the
 * provider-id routes are gated — Amarnai's own surfaces address threads by our
 * id and are never gated.
 */
export async function isInjectionEnabled(
  workspaceId: string,
  surface: "threadSummary" | "replyButton",
): Promise<boolean> {
  const settings = await db.gmailSyncSettings.findUnique({
    where: { workspaceId },
    select: { threadSummaryInjectionEnabled: true, replyButtonInjectionEnabled: true },
  });
  if (!settings) return true;
  return surface === "threadSummary"
    ? settings.threadSummaryInjectionEnabled
    : settings.replyButtonInjectionEnabled;
}
