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

// In-memory stub of the atomic INCR-with-first-hit-EXPIRE Lua eval. It mirrors the
// script's semantics (INCR; EXPIRE only when the count is 1) so we can assert the
// fixed-window behavior AND that the TTL is applied inside the single eval — never
// as a separable command that a crash could drop.
function makeStore(): RateLimitStore & { ttlSets: () => number } {
  let count = 0;
  let ttlSets = 0;
  return {
    eval: vi.fn(async (_script: string, _numKeys: number, _key: string | number, ttl: string | number) => {
      count += 1;
      // The real Lua sets EXPIRE only on the first hit, atomically with the INCR.
      if (count === 1) {
        expect(Number(ttl)).toBe(900);
        ttlSets += 1;
      }
      return count;
    }),
    ttlSets: () => ttlSets,
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

  it("applies the TTL only on the first hit, atomically inside the single eval", async () => {
    const store = makeStore();
    await checkRateLimit(store, "k", 5, 900);
    await checkRateLimit(store, "k", 5, 900);
    await checkRateLimit(store, "k", 5, 900);
    // One atomic op per call — the TTL travels with the increment, so there is no
    // separate EXPIRE command that a dropped connection could lose.
    expect(store.eval).toHaveBeenCalledTimes(3);
    // TTL set exactly once (first hit only): fixed window, not re-armed per hit.
    expect(store.ttlSets()).toBe(1);
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
