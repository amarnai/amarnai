// In-process TTL cache with a stale-if-error fallback. It backs the per-request
// session-epoch enforcement on both hot auth paths — the web JWT resolution
// (session-jwt) and the API bearer check (app.ts) — and exists for two reasons:
//
//   1. Keep a blocking DB read off every authenticated request. Enforcement runs
//      on every page load / every native call; without a cache that is one
//      indexed read per request.
//   2. Keep a transient DB error from turning every authenticated request into a
//      500. The pre-cache code did an unguarded findUnique on this path, so a DB
//      blip 500'd all logged-in traffic (web) / all bearer traffic (API).
//
// Correctness is preserved: the cached value IS the account's identity/epoch as
// last read, so a revocation (epoch bump on password reset / pre-hijack
// invalidation) is still honored — within at most one TTL. Only INFRASTRUCTURE
// errors degrade, and only in this order:
//
//   fresh   — cached value still inside its TTL; loader not called.
//   loaded  — TTL expired or no entry; loader ran and refreshed the entry.
//   stale   — loader threw, but a prior (now-expired) entry exists; serve it, so
//             a revocation seen before the outage is still enforced.
//   unavailable — loader threw and nothing was ever cached; the caller decides
//                 (fail open), and only here can a revoked session slip through,
//                 for the duration of the outage on an instance that never saw
//                 the user. This is the smallest possible fail-open surface.
//
// A loader that RESOLVES to null (deleted account) is a real value, cached and
// enforced like any other — distinct from a loader that THROWS (the DB is down).
//
// A mint (initial sign-in) must never read through this cache: it has to stamp
// the account's exact current epoch, and it must fail rather than stamp a stale
// one. Mint paths read the DB directly and only write-through via `set`.

const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;

type Entry<V> = { value: V; expiresAt: number };

export type CacheOutcome<V> =
  | { status: "fresh" | "loaded" | "stale"; value: V }
  | { status: "unavailable"; value: null };

export class StaleWhileErrorCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  // `now` is injectable so the TTL/eviction logic is unit-testable without a
  // real clock (mirrors the injectable clock in the web rate limiter).
  constructor(ttlMs: number = DEFAULT_TTL_MS, now: () => number = () => Date.now()) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  // Serve `key` from cache when fresh; otherwise run `loader`, refreshing the
  // entry on success and falling back to the stale value (or "unavailable") when
  // it throws. See the file header for the four outcomes.
  async get(key: string, loader: () => Promise<V>): Promise<CacheOutcome<V>> {
    const cached = this.entries.get(key);
    const t = this.now();
    if (cached && cached.expiresAt > t) {
      return { status: "fresh", value: cached.value };
    }
    try {
      const value = await loader();
      this.set(key, value);
      return { status: "loaded", value };
    } catch {
      if (cached) return { status: "stale", value: cached.value };
      return { status: "unavailable", value: null };
    }
  }

  // Write-through, used by mint paths that have just read the DB directly so a
  // burst of enforcement reads right after sign-in does not stampede the DB.
  set(key: string, value: V): void {
    // Bound memory under churn/abuse: drop the oldest-inserted entry when full.
    // Map preserves insertion order, so the first key is the oldest.
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  // Drop an entry so the next lookup reads fresh. Called after an in-process
  // epoch bump to shrink the revocation window below the TTL; cross-process
  // staleness is still bounded by the TTL.
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  // Drop every entry. Primarily for tests, which share the module-singleton
  // instances and must isolate cache state between cases.
  clear(): void {
    this.entries.clear();
  }
}
