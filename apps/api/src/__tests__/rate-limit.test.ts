import { vi, describe, it, expect } from "vitest";
import type { Context } from "hono";
import { checkRateLimit, clientIp, type RateLimitStore } from "../services/rate-limit.js";

// Minimal Context stub: only header lookups matter here. No node-server bindings,
// so the socket-address fallback (getConnInfo) throws and resolves to "unknown" —
// which is exactly what lets us assert that a spoofed XFF is NOT used.
function ctx(headers: Record<string, string>): Context {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] },
  } as unknown as Context;
}

// In-memory stub that mimics Redis INCR/EXPIRE for the counter logic.
function makeStore(): RateLimitStore & { expire: ReturnType<typeof vi.fn> } {
  let count = 0;
  return {
    incr: vi.fn(async () => ++count),
    expire: vi.fn(async () => 1),
  };
}

describe("checkRateLimit", () => {
  it("allows requests up to the limit, then blocks", async () => {
    const store = makeStore();
    const allowed: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      allowed.push((await checkRateLimit(store, "k", 10, 900)).allowed);
    }
    expect(allowed.slice(0, 10).every(Boolean)).toBe(true); // first 10 pass
    expect(allowed[10]).toBe(false); // 11th blocked
    expect(allowed[11]).toBe(false);
  });

  it("reports remaining count and retry-after", async () => {
    const store = makeStore();
    const first = await checkRateLimit(store, "k", 3, 900);
    expect(first).toEqual({ allowed: true, remaining: 2, retryAfter: 900 });
  });

  it("sets the TTL only on the first hit of the window", async () => {
    const store = makeStore();
    await checkRateLimit(store, "k", 5, 900);
    await checkRateLimit(store, "k", 5, 900);
    await checkRateLimit(store, "k", 5, 900);
    expect(store.expire).toHaveBeenCalledTimes(1);
    expect(store.expire).toHaveBeenCalledWith("k", 900);
  });
});

describe("clientIp (XFF trust)", () => {
  it("ignores a spoofed X-Forwarded-For when trustProxy is 0 (#10)", () => {
    // The attacker-controlled header must NOT become the key; with no socket
    // binding it resolves to "unknown", never the spoofed value.
    expect(clientIp(ctx({ "x-forwarded-for": "9.9.9.9" }), 0)).not.toBe("9.9.9.9");
    expect(clientIp(ctx({ "x-real-ip": "9.9.9.9" }), 0)).not.toBe("9.9.9.9");
  });

  it("reads the client from XFF at the trusted-hop offset", () => {
    // One trusted proxy that appended the client's address.
    expect(clientIp(ctx({ "x-forwarded-for": "1.1.1.1" }), 1)).toBe("1.1.1.1");
    // Two hops (CDN + nginx): client is two from the right.
    expect(clientIp(ctx({ "x-forwarded-for": "1.1.1.1, 3.3.3.3" }), 2)).toBe("1.1.1.1");
  });

  it("ignores entries to the left of the trusted proxies (spoof-proof)", () => {
    // Attacker prepends 9.9.9.9; with 1 trusted hop we take the rightmost entry
    // (what our own proxy observed), never the injected one.
    expect(clientIp(ctx({ "x-forwarded-for": "9.9.9.9, 1.1.1.1, 3.3.3.3" }), 1)).toBe("3.3.3.3");
  });
});
