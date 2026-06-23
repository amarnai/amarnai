// Post-connect hooks: after a Gmail connection is established (first Google
// sign-in or the OAuth callback), kick off an immediate inbox sync and register
// the Gmail push watch. Both are fire-and-forget — failures are non-fatal
// because the polling scheduler covers sync and the worker's daily renewal
// covers the watch — but they must still be *visible* in logs when they break.

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
 * Trigger the immediate inbox sync and Gmail push-watch registration that
 * follow a fresh Gmail connection. `source` tags the log line with the call
 * site ("auth" or "gmail/callback").
 */
export function triggerPostConnectHooks(source: string, workspaceId: string, userId: string): void {
  postInternal(source, "trigger_sync", workspaceId, userId, `/workspaces/${workspaceId}/trigger-sync`);
  postInternal(source, "register_watch", workspaceId, userId, `/workspaces/${workspaceId}/register-gmail-watch`);
}
