import { vi, describe, it, expect } from "vitest";
import { checkRateLimit, type RateLimitStore } from "../services/rate-limit.js";

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
