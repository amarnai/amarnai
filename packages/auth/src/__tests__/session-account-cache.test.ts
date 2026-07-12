import { describe, it, expect, vi } from "vitest";
import { StaleWhileErrorCache } from "../session-account-cache.js";

// Controllable clock so TTL/eviction is deterministic.
function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("StaleWhileErrorCache", () => {
  it("returns a fresh hit within the TTL without calling the loader again", async () => {
    const c = clock();
    const cache = new StaleWhileErrorCache<number>(30_000, c.now);
    const loader = vi.fn(async () => 42);

    const first = await cache.get("k", loader);
    expect(first).toEqual({ status: "loaded", value: 42 });

    c.advance(10_000); // still inside the 30s TTL
    const second = await cache.get("k", loader);
    expect(second).toEqual({ status: "fresh", value: 42 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("re-invokes the loader once the entry has expired", async () => {
    const c = clock();
    const cache = new StaleWhileErrorCache<number>(30_000, c.now);
    const loader = vi.fn(async () => 1);

    await cache.get("k", loader);
    c.advance(31_000); // past the TTL
    const out = await cache.get("k", vi.fn(async () => 2));
    expect(out).toEqual({ status: "loaded", value: 2 });
  });

  it("serves the stale value when the loader throws but a prior entry exists", async () => {
    const c = clock();
    const cache = new StaleWhileErrorCache<number>(30_000, c.now);

    await cache.get("k", async () => 7); // seed
    c.advance(31_000); // expire it
    const out = await cache.get("k", async () => {
      throw new Error("db down");
    });
    expect(out).toEqual({ status: "stale", value: 7 });
  });

  it("returns unavailable when the loader throws and nothing was ever cached", async () => {
    const cache = new StaleWhileErrorCache<number>();
    const out = await cache.get("cold", async () => {
      throw new Error("db down");
    });
    expect(out).toEqual({ status: "unavailable", value: null });
  });

  it("caches a resolved null as a real value (deleted account stays enforced)", async () => {
    const c = clock();
    const cache = new StaleWhileErrorCache<number | null>(30_000, c.now);
    const loader = vi.fn(async () => null);

    await cache.get("gone", loader);
    c.advance(5_000);
    const out = await cache.get("gone", loader);
    expect(out).toEqual({ status: "fresh", value: null });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("invalidate forces the next lookup to hit the loader", async () => {
    const cache = new StaleWhileErrorCache<number>();
    const loader = vi.fn(async () => 5);

    await cache.get("k", loader);
    cache.invalidate("k");
    await cache.get("k", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("set write-through is served as a fresh hit", async () => {
    const c = clock();
    const cache = new StaleWhileErrorCache<number>(30_000, c.now);
    cache.set("k", 99);
    const out = await cache.get("k", async () => {
      throw new Error("loader must not run");
    });
    expect(out).toEqual({ status: "fresh", value: 99 });
  });
});
