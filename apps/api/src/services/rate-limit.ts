import { Redis } from "ioredis";
import { getConnInfo } from "@hono/node-server/conninfo";
import { config } from "@amarnai/config";
import type { Context, MiddlewareHandler } from "hono";

// Redis-backed fixed-window rate limiting for the public /auth/* endpoints, the
// only routes reachable without a token and therefore the brute-force surface.
// Redis (not in-memory) so the limit holds across API instances in the hosted
// deployment. Fails open if the store is unavailable: a rate-limit outage must
// never lock users out of signing in.
//
// Disabled under NODE_ENV=test (deterministic suites) and when self-host opts
// out via AUTH_RATE_LIMIT_DISABLED (e.g. throttling at the proxy instead).
const DISABLED = process.env["NODE_ENV"] === "test" || config.authRateLimit.disabled;

// Minimal surface so the counter can be unit-tested with a stub. ioredis
// satisfies this structurally.
export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

let client: Redis | null = null;
function getClient(): Redis {
  if (!client) {
    client = new Redis(config.redis.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      // Keep trying to (re)connect in the background so the limiter self-heals
      // after Redis restarts. Capped backoff; the status guard fails open until ready.
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    // Swallow connection errors here; the middleware fails open on rejection.
    client.on("error", () => undefined);
    // Warm the connection now instead of on the first command. With lazyConnect
    // the socket connects only when a command is issued, but enableOfflineQueue is
    // false, so that first command is rejected mid-handshake ("Stream isn't
    // writeable"). Connecting eagerly lets the status guard below fail open
    // quietly during warmup rather than throwing on real traffic.
    client.connect().catch(() => undefined);
  }
  return client;
}

// One-shot per-key throttle: true if this is the first call for `key` within the
// window (proceed), false if a prior call already claimed it (suppress). Used to
// stop per-account email flooding (e.g. "you already have an account" notices).
// Fails OPEN (true) when the store is unavailable so a Redis outage never
// suppresses a legitimate email; a no-op (always true) under the test/self-host
// disable switch, matching the rate-limit middleware.
export async function throttleOnce(key: string, windowSeconds: number): Promise<boolean> {
  if (DISABLED) return true;
  const store = getClient();
  if (store.status !== "ready") return true;
  try {
    const count = await store.incr(key);
    if (count === 1) {
      await store.expire(key, windowSeconds);
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export type RateLimitDecision = { allowed: boolean; remaining: number; retryAfter: number };

// Fixed-window counter: INCR the key and set the TTL on the first hit of a
// window. Exported for unit testing with a stub store.
export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitDecision> {
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, windowSeconds);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: windowSeconds };
}

function socketIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

// Resolves the client IP used as the rate-limit key. Only trusts forwarded
// headers when TRUST_PROXY says how many reverse proxies we actually run:
//   - 0 (default): ignore X-Forwarded-For / X-Real-IP entirely and key on the
//     socket address. A direct caller then cannot spoof an arbitrary IP per
//     request to dodge the limit (the pre-fix bug: XFF's leftmost, fully
//     attacker-controlled, was trusted unconditionally).
//   - N >= 1: read the client from the XFF entry just before our N trusted
//     proxies (rightmost is what our own proxy observed; everything to its left
//     is caller-controlled). Falls back to the socket address if the header is
//     absent or too short.
export function clientIp(c: Context, trustProxy: number): string {
  if (trustProxy <= 0) return socketIp(c);

  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const idx = parts.length - trustProxy;
    if (idx >= 0 && idx < parts.length) return parts[idx]!;
  }
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  return socketIp(c);
}

export function rateLimit(opts: {
  limit: number;
  windowSeconds: number;
  prefix: string;
}): MiddlewareHandler {
  return async (c, next) => {
    if (DISABLED) return next();
    const store = getClient();
    // Fail open quietly while the connection is warming up or Redis is down.
    // Issuing a command in a non-ready state throws immediately (the offline
    // queue is disabled), so guard instead of catching a noisy exception.
    if (store.status !== "ready") return next();
    const key = `ratelimit:${opts.prefix}:${clientIp(c, config.authRateLimit.trustProxy)}`;
    try {
      const { allowed, retryAfter } = await checkRateLimit(
        store,
        key,
        opts.limit,
        opts.windowSeconds
      );
      if (!allowed) {
        return c.json({ error: "Too many requests" }, 429, { "Retry-After": String(retryAfter) });
      }
    } catch (err) {
      // Fail open: never block sign-in because the rate-limit store is down.
      console.error("[rate-limit] store error (failing open):", err instanceof Error ? err.message : err);
    }
    return next();
  };
}
