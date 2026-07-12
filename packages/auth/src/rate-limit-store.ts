import { Redis } from "ioredis";
import { config } from "@amarnai/config";

// Redis-backed fixed-window rate limiting, shared by the API's public /auth/*
// middleware and the web server-action auth throttles. One store so the limit
// holds across instances in the hosted deployment (per-instance in-memory buckets
// diverge, letting an attacker multiply their budget by the replica count) and so
// both surfaces share one fail-open policy: a rate-limit outage must NEVER lock
// users out of signing in.
//
// Disabled under NODE_ENV=test (deterministic suites) and when a self-host opts
// out via AUTH_RATE_LIMIT_DISABLED (e.g. throttling at the proxy instead).
export const RATE_LIMIT_DISABLED =
  process.env["NODE_ENV"] === "test" || config.authRateLimit.disabled;

// Minimal surface so the counter logic can be unit-tested with a stub. ioredis
// satisfies this structurally.
export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

let client: Redis | null = null;
export function getRateLimitClient(): Redis {
  if (!client) {
    client = new Redis(config.redis.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      // Keep trying to (re)connect in the background so the limiter self-heals
      // after Redis restarts. Capped backoff; callers fail open until ready.
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    // Swallow connection errors here; callers fail open on a non-ready status.
    client.on("error", () => undefined);
    // Warm the connection now instead of on the first command. With lazyConnect
    // the socket connects only on first command, but enableOfflineQueue is false,
    // so that first command is rejected mid-handshake. Connecting eagerly lets the
    // status guards fail open quietly during warmup rather than throwing.
    client.connect().catch(() => undefined);
  }
  return client;
}

export type RateLimitDecision = { allowed: boolean; remaining: number; retryAfter: number };

// Fixed-window counter: INCR the key and set the TTL on the first hit of a
// window. Exported for unit testing with a stub store.
export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, windowSeconds);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: windowSeconds };
}

// Count-all check: records this attempt and returns true if the key is now over
// the limit. For surfaces where every attempt IS the cost (register /
// forgot-password email amplification). Fails OPEN (not limited) when the store
// is disabled or unavailable.
export async function checkAndCount(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (RATE_LIMIT_DISABLED) return false;
  const store = getRateLimitClient();
  if (store.status !== "ready") return false;
  try {
    const { allowed } = await checkRateLimit(store, key, limit, windowSeconds);
    return !allowed;
  } catch {
    return false;
  }
}

// Read a counter WITHOUT incrementing it — the "check before the attempt" half of
// a failures-only throttle (login). Returns 0 (treated as not blocked) when the
// store is disabled, unavailable, or the key is absent, so a store outage never
// blocks a legitimate sign-in.
export async function peekCount(key: string): Promise<number> {
  if (RATE_LIMIT_DISABLED) return 0;
  const store = getRateLimitClient();
  if (store.status !== "ready") return 0;
  try {
    const v = await store.get(key);
    const n = v ? Number.parseInt(v, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// Record one hit against a fixed-window counter — the "record after a failure"
// half of a failures-only throttle. Applies the TTL on the first hit. A failure
// to record just means no throttle (fail open); never throws.
export async function incrementCount(key: string, windowSeconds: number): Promise<void> {
  if (RATE_LIMIT_DISABLED) return;
  const store = getRateLimitClient();
  if (store.status !== "ready") return;
  try {
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, windowSeconds);
  } catch {
    // Fail open: not recording an attempt only relaxes the throttle.
  }
}

// Delete a counter — the "clear on success" half of a failures-only throttle, so a
// user who mistyped a few times is not left throttled after a real sign-in.
export async function clearKey(key: string): Promise<void> {
  if (RATE_LIMIT_DISABLED) return;
  const store = getRateLimitClient();
  if (store.status !== "ready") return;
  try {
    await store.del(key);
  } catch {
    // Fail open: a stuck counter self-expires at the window boundary anyway.
  }
}

// One-shot per-key throttle: true if this is the first call for `key` within the
// window (proceed), false if a prior call already claimed it (suppress). Used to
// stop per-account email flooding (e.g. "you already have an account" notices).
// Fails OPEN (true) when the store is unavailable so an outage never suppresses a
// legitimate email; a no-op (always true) under the disable switch.
export async function throttleOnce(key: string, windowSeconds: number): Promise<boolean> {
  if (RATE_LIMIT_DISABLED) return true;
  const store = getRateLimitClient();
  if (store.status !== "ready") return true;
  try {
    // Atomic claim: SET only if absent, with the TTL applied in the same command.
    // Unlike INCR-then-EXPIRE this cannot leave a key without an expiry (a lost
    // EXPIRE there would suppress the recipient's notices forever). "OK" means we
    // won the window and should proceed; null means a live claim already exists.
    const res = await store.set(key, "1", "EX", windowSeconds, "NX");
    return res === "OK";
  } catch {
    return true;
  }
}
