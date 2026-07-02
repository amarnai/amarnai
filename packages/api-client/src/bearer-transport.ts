import type { ApiTransport, TransportInit } from "./transport.js";

// Persisted auth tokens. The access token is short-lived; the refresh token is
// long-lived and single-use (rotated on every /auth/refresh).
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

// The minimal storage surface the transport depends on, so it can be unit-tested
// with an in-memory stub instead of a real device keystore / chrome.storage.
export interface TokenStore {
  get(): Promise<StoredTokens | null>;
  set(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

export interface BearerTransportDeps {
  // Absolute API base, e.g. http://localhost:3001 (no trailing slash).
  baseUrl: string;
  tokenStore: TokenStore;
  // Injected for tests; defaults to the global fetch. Typed against how the
  // transport actually calls it (string url) so it does not depend on a DOM
  // `fetch` lib type that some consumers' tsconfigs omit.
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  // Called once when a refresh fails and the session is no longer valid, so the
  // session layer can flip to signed-out and route to the sign-in screen.
  onAuthFailure?: () => void;
  // Client locale sent as Accept-Language so the API can seed a new workspace's
  // language from the creator's client. Optional so tests need not provide it.
  acceptLanguage?: string;
}

function toRecord(headers: RequestInit["headers"]): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) return Object.fromEntries(headers as [string, string][]);
  // A Headers instance (or anything iterable via entries()). Typed structurally
  // so this does not depend on the ambient `Headers` DOM lib type, which varies
  // between the consumers' tsconfigs (web/extension have dom, node clients don't).
  const iterable = headers as { entries?: () => IterableIterator<[string, string]> };
  if (typeof iterable.entries === "function") {
    return Object.fromEntries(iterable.entries());
  }
  return headers as Record<string, string>;
}

// Build a fetch init with the bearer token applied. `next` is a Next.js-only
// hint the api-client may attach; strip it so it never reaches a plain fetch.
function withAuth(
  init: TransportInit,
  accessToken: string | null,
  acceptLanguage?: string,
): RequestInit {
  const { next: _next, headers, ...rest } = init;
  const merged: Record<string, string> = { ...toRecord(headers) };
  if (accessToken) merged["Authorization"] = `Bearer ${accessToken}`;
  if (acceptLanguage && !merged["Accept-Language"]) merged["Accept-Language"] = acceptLanguage;
  return { ...rest, headers: merged };
}

/**
 * A per-user bearer-token API transport for native clients (mobile app, browser
 * extension). Attaches the access token to every request and, on a 401,
 * transparently refreshes once and retries:
 *
 *   request -> 401 -> POST /auth/refresh (single-flight) -> retry with new token
 *
 * Concurrent 401s share one in-flight refresh so the rotating refresh token is
 * never spent twice. If the refresh itself fails the tokens are cleared and
 * `onAuthFailure` fires; the original 401 is returned so the caller still sees a
 * failed request (it surfaces as a sign-out, not a hang). A network error during
 * refresh does not clear tokens — the session may still be valid once
 * connectivity returns. Pure over an injected fetch + token store so it is
 * unit-testable without a device.
 */
export function makeBearerTransport(deps: BearerTransportDeps): ApiTransport {
  const { baseUrl, tokenStore } = deps;
  const doFetch: (url: string, init?: RequestInit) => Promise<Response> =
    deps.fetchImpl ?? ((url, init) => fetch(url, init));

  // Single-flight refresh shared across concurrent 401s.
  let refreshing: Promise<string | null> | null = null;

  async function doRefresh(): Promise<string | null> {
    const current = await tokenStore.get();
    if (!current?.refreshToken) {
      await tokenStore.clear();
      deps.onAuthFailure?.();
      return null;
    }
    try {
      const res = await doFetch(`${baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        await tokenStore.clear();
        deps.onAuthFailure?.();
        return null;
      }
      const pair = (await res.json()) as StoredTokens;
      await tokenStore.set(pair);
      return pair.accessToken;
    } catch {
      // Network error during refresh: do not clear tokens (the session may still
      // be valid once connectivity returns); just fail this attempt.
      return null;
    }
  }

  function refreshAccess(): Promise<string | null> {
    if (!refreshing) {
      refreshing = doRefresh().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  return {
    baseUrl,
    async fetch(url, init) {
      const tokens = await tokenStore.get();
      const res = await doFetch(url, withAuth(init, tokens?.accessToken ?? null, deps.acceptLanguage));
      if (res.status !== 401) return res;

      const newAccess = await refreshAccess();
      if (!newAccess) return res; // refresh failed -> return the original 401
      return doFetch(url, withAuth(init, newAccess, deps.acceptLanguage));
    },
  };
}
