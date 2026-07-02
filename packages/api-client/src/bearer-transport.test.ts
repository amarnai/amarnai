import { describe, it, expect, vi } from "vitest";
import { makeBearerTransport, type StoredTokens, type TokenStore } from "./bearer-transport.js";

const BASE = "http://api.test";
const DATA_URL = `${BASE}/workspaces`;

function res(status: number, body: unknown = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

function memStore(initial: StoredTokens | null) {
  let tokens = initial;
  return {
    get: vi.fn(async () => tokens),
    set: vi.fn(async (t: StoredTokens) => {
      tokens = t;
    }),
    clear: vi.fn(async () => {
      tokens = null;
    }),
  } satisfies TokenStore;
}

const TOKENS: StoredTokens = {
  accessToken: "a1",
  refreshToken: "r1",
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

const NEW_TOKENS: StoredTokens = {
  accessToken: "a2",
  refreshToken: "r2",
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

function authHeader(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.["Authorization"];
}

describe("makeBearerTransport", () => {
  it("attaches the bearer token and does not refresh on success", async () => {
    const store = memStore(TOKENS);
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => res(200, { ok: true }));
    const t = makeBearerTransport({ baseUrl: BASE, tokenStore: store, fetchImpl });

    const r = await t.fetch(DATA_URL, { method: "GET" });

    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(authHeader(fetchImpl.mock.calls[0]![1])).toBe("Bearer a1");
    expect(store.set).not.toHaveBeenCalled();
  });

  it("adds Accept-Language when provided and not already set", async () => {
    const store = memStore(TOKENS);
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => res(200));
    const t = makeBearerTransport({ baseUrl: BASE, tokenStore: store, fetchImpl, acceptLanguage: "fr-FR" });

    await t.fetch(DATA_URL, { method: "GET" });

    const headers = fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["Accept-Language"]).toBe("fr-FR");
  });

  it("refreshes once on 401, persists the rotated pair, and retries with the new token", async () => {
    const store = memStore(TOKENS);
    let dataCalls = 0;
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return res(200, NEW_TOKENS);
      dataCalls += 1;
      return dataCalls === 1 ? res(401) : res(200, { ok: true });
    });

    const t = makeBearerTransport({ baseUrl: BASE, tokenStore: store, fetchImpl });
    const r = await t.fetch(DATA_URL, { method: "GET" });

    expect(r.status).toBe(200);
    // data(401) + refresh + data(retry) = 3 calls
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(store.set).toHaveBeenCalledWith(NEW_TOKENS);
    const retry = fetchImpl.mock.calls.find(
      (c, i) => i > 0 && !String(c[0]).endsWith("/auth/refresh"),
    );
    expect(authHeader(retry?.[1])).toBe("Bearer a2");
  });

  it("clears tokens, signals auth failure, and returns the 401 when refresh fails", async () => {
    const store = memStore(TOKENS);
    const onAuthFailure = vi.fn();
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => res(401));

    const t = makeBearerTransport({ baseUrl: BASE, tokenStore: store, fetchImpl, onAuthFailure });
    const r = await t.fetch(DATA_URL, { method: "GET" });

    expect(r.status).toBe(401);
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("does not clear tokens when the refresh request throws (network error)", async () => {
    const store = memStore(TOKENS);
    const onAuthFailure = vi.fn();
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/auth/refresh")) throw new Error("network down");
      return res(401);
    });

    const t = makeBearerTransport({ baseUrl: BASE, tokenStore: store, fetchImpl, onAuthFailure });
    const r = await t.fetch(DATA_URL, { method: "GET" });

    expect(r.status).toBe(401);
    expect(store.clear).not.toHaveBeenCalled();
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("shares a single refresh across concurrent 401s (rotating token spent once)", async () => {
    const store = memStore(TOKENS);
    let refreshCalls = 0;
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return res(200, NEW_TOKENS);
      }
      return store.set.mock.calls.length === 0 ? res(401) : res(200, { ok: true });
    });

    const t = makeBearerTransport({ baseUrl: BASE, tokenStore: store, fetchImpl });
    const [a, b] = await Promise.all([
      t.fetch(DATA_URL, { method: "GET" }),
      t.fetch(DATA_URL, { method: "GET" }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(refreshCalls).toBe(1);
  });
});
