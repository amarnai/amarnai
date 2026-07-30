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
 * Map a provider thread id to our internal thread id within a workspace.
 * Returns null when the thread was never synced — callers turn that into a 404,
 * which the injected surfaces render as "not synced yet" (or as nothing at all).
 *
 * One indexed lookup on (workspaceId, providerThreadId). It used to fan out over
 * the workspace's email accounts because only the (emailAccountId,
 * providerThreadId) unique key existed; the dedicated index removed the need.
 */
export async function resolveProviderThreadId(
  workspaceId: string,
  providerThreadId: string,
): Promise<string | null> {
  const thread = await db.emailThread.findFirst({
    where: {
      workspaceId,
      providerThreadId: normalizeProviderThreadId(providerThreadId),
    },
    select: { id: true },
  });
  return thread?.id ?? null;
}

/**
 * What kind of provider id an injected surface is holding.
 *
 * "thread" is the ordinary case and every surface's default: a mail page names
 * the conversation it is showing, and that is what Amarnai keys threads by.
 *
 * "message" exists for one layout that cannot name a conversation at all. OWA's
 * standalone deeplink read view (`/mail/deeplink/read/<id>?ItemID=<id>`) is an
 * ITEM view: it renders a single message, carries no `data-convid` anywhere in
 * its DOM, and its only id — in the URL and in element ids like `678_<id>` — is
 * the message's store id. Verified against live data (2026-07-30): that id,
 * normalized onto the stored alphabet, is byte-identical to the
 * `providerMessageId` we already store, so the thread is reachable without a
 * schema change.
 *
 * Explicit rather than inferred. Both id flavors are 68-char base64 for a
 * consumer mailbox, so "try thread, then message" would work only by the grace
 * of their entropy, and a caller that means one thing must not silently resolve
 * as the other.
 */
export type ProviderRefKind = "thread" | "message";

export function isProviderRefKind(value: unknown): value is ProviderRefKind {
  return value === "thread" || value === "message";
}

/**
 * Map a provider MESSAGE id to the internal id of the thread that contains it.
 *
 * Scoped through the workspace's own accounts rather than by `workspaceId`
 * directly, and that is a performance requirement rather than a style choice:
 * the only index covering this column is `@@unique([emailAccountId,
 * providerMessageId])`, whose leading column is the account. A query on
 * (workspaceId, providerMessageId) cannot use it and degrades to a scan of every
 * message row — which at hosted scale is a table this must never touch. The
 * account list is small and indexed, so the fan-out is the cheap half.
 *
 * It is also the correctness half. `providerMessageId` is unique per ACCOUNT, not
 * globally: live data has the same message id under three different accounts, so
 * an unscoped lookup could answer with another tenant's thread.
 */
export async function resolveProviderMessageId(
  workspaceId: string,
  providerMessageId: string,
): Promise<string | null> {
  const accounts = await db.emailAccount.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  if (accounts.length === 0) return null;

  const message = await db.emailMessage.findFirst({
    where: {
      emailAccountId: { in: accounts.map((a) => a.id) },
      providerMessageId: normalizeProviderThreadId(providerMessageId),
    },
    select: { emailThreadId: true },
  });
  return message?.emailThreadId ?? null;
}

/**
 * Resolve whichever kind of provider id a surface is holding to our internal
 * thread id. The one entry point the provider-id routes call, so a thread that
 * resolves for the panel resolves for the draft and the summary too.
 */
export async function resolveProviderRef(
  workspaceId: string,
  kind: ProviderRefKind,
  id: string,
): Promise<string | null> {
  return kind === "message"
    ? resolveProviderMessageId(workspaceId, id)
    : resolveProviderThreadId(workspaceId, id);
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
  surface: "threadSummary" | "replyButton" | "injectedPanel",
): Promise<boolean> {
  const settings = await db.gmailSyncSettings.findUnique({
    where: { workspaceId },
    select: {
      threadSummaryInjectionEnabled: true,
      replyButtonInjectionEnabled: true,
      injectedPanelEnabled: true,
    },
  });
  if (!settings) return true;
  if (surface === "threadSummary") return settings.threadSummaryInjectionEnabled;
  if (surface === "replyButton") return settings.replyButtonInjectionEnabled;
  return settings.injectedPanelEnabled;
}
