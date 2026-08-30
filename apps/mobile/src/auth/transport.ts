import type { ApiTransport, TransportInit } from '@aziru/api-client';
import type { StoredTokens, TokenStore } from './tokenStore';

export interface MobileTransportDeps {
  // Absolute API base, e.g. http://192.168.1.20:3001 (no trailing slash).
  baseUrl: string;
  tokenStore: TokenStore;
  // Injected for tests; defaults to the global fetch. Typed against how the
  // transport actually calls it (string url) so it does not depend on the DOM
  // `fetch` lib type, which the React Native tsconfig does not include.
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  // Called once when a refresh fails and the session is no longer valid, so the
  // session layer can flip to signed-out and route to the sign-in screen.
  onAuthFailure?: () => void;
  // Device locale sent as Accept-Language so the API can seed a new workspace's
  // language from the creator's device. Optional so tests need not provide it.
  acceptLanguage?: string;
}

function toRecord(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) return Object.fromEntries(headers as [string, string][]);
  if (typeof (headers as { entries?: unknown }).entries === 'function') {
    return Object.fromEntries((headers as Headers).entries());
  }
  return headers as Record<string, string>;
}

// Build a fetch init with the bearer token applied. `next` is a Next.js-only
// hint the api-client may attach; strip it so it never reaches RN fetch.
function withAuth(
  init: TransportInit,
  accessToken: string | null,
  acceptLanguage?: string,
): RequestInit {
  const { next: _next, headers, ...rest } = init;
  const merged: Record<string, string> = { ...toRecord(headers) };
  if (accessToken) merged['Authorization'] = `Bearer ${accessToken}`;
  if (acceptLanguage && !merged['Accept-Language']) merged['Accept-Language'] = acceptLanguage;
  return { ...rest, headers: merged };
}

/**
 * The mobile API transport. Attaches the per-user access token to every request
 * and, on a 401, transparently refreshes once and retries:
 *
 *   request -> 401 -> POST /auth/refresh (single-flight) -> retry with new token
 *
 * Concurrent 401s share one in-flight refresh so the rotating refresh token is
 * never spent twice. If the refresh itself fails the tokens are cleared and
 * `onAuthFailure` fires; the original 401 is returned so the caller still sees a
 * failed request (it will surface as a sign-out, not a hang). Pure over an
 * injected fetch + token store so it is unit-testable without a device.
 */
export function makeMobileTransport(deps: MobileTransportDeps): ApiTransport {
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
