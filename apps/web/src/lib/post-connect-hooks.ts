// Post-connect hooks: after a Gmail connection is established (first Google
// sign-in or the OAuth callback), kick off an immediate inbox sync and register
// the Gmail push watch. Both are fire-and-forget — failures are non-fatal
// because the polling scheduler covers sync and the worker's daily renewal
// covers the watch — but they must still be *visible* in logs when they break.

import { maybeCreateExtensionNudge } from "@aziru/db";

/**
 * Describe a fetch failure for logging. A rejected `fetch` is a bare
 * `TypeError: fetch failed`; the real reason (ECONNREFUSED, ENOTFOUND, a TLS
 * fault) lives on `err.cause`, which the top-level message hides. Walk the
 * cause chain so the log line names the actual transport error.
 */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  let cause: unknown = (err as { cause?: unknown }).cause;
  while (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    parts.push(`${typeof code === "string" ? `${code}: ` : ""}${cause.message}`);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(" ← ");
}

/**
 * Fire-and-forget POST to an internal API endpoint with structured failure
 * logging. Unlike a bare `fetch().catch()`, this surfaces BOTH failure modes:
 *   - a rejected fetch (network error), including the underlying `cause`;
 *   - a resolved-but-non-2xx response, which `.catch()` never sees and would
 *     otherwise be swallowed silently.
 */
function postInternal(
  source: string,
  step: string,
  workspaceId: string,
  userId: string,
  path: string,
): void {
  const apiBase = process.env["API_URL"] ?? "http://localhost:3001";
  const secret = process.env["INTERNAL_API_SECRET"] ?? "dev-internal-secret";
  const url = `${apiBase}${path}`;

  void (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "X-User-Id": userId },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(
          `[${source}] ${step} failed: ${res.status} ${res.statusText} ` +
            `(workspace=${workspaceId}, url=${url})${body ? ` — ${body.slice(0, 200)}` : ""}`,
        );
      }
    } catch (err) {
      console.error(
        `[${source}] ${step} fetch error (workspace=${workspaceId}, url=${url}): ${describeFetchError(err)}`,
      );
    }
  })();
}

/**
 * Trigger the immediate inbox sync and push-watch/subscription registration that
 * follow a fresh mailbox connection. `source` tags the log line with the call
 * site ("auth", "gmail/callback", "outlook/callback"). `provider` selects the
 * push-registration endpoint (Gmail Pub/Sub watch vs Graph subscription); the
 * trigger-sync hook is provider-neutral.
 */
export function triggerPostConnectHooks(
  source: string,
  workspaceId: string,
  userId: string,
  provider: "gmail" | "outlook" = "gmail",
): void {
  const registerPath =
    provider === "outlook"
      ? `/workspaces/${workspaceId}/register-outlook-subscription`
      : `/workspaces/${workspaceId}/register-gmail-watch`;

  postInternal(source, "trigger_sync", workspaceId, userId, `/workspaces/${workspaceId}/trigger-sync`);
  postInternal(source, "register_watch", workspaceId, userId, registerPath);

  // Gmail is now connected — the earliest moment the extension's side panel has
  // real triaged threads to show. Produce the one-time install nudge (no-op if
  // they already have the extension or were already nudged). Best-effort; a
  // failure must not affect the connect flow.
  void maybeCreateExtensionNudge({ userId, workspaceId }).catch((err) =>
    console.error(
      `[${source}] extension_nudge failed (workspace=${workspaceId}): ${describeFetchError(err)}`,
    ),
  );
}
