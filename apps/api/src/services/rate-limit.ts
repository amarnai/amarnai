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
    });
    // Swallow connection errors here; the middleware fails open on rejection.
    client.on("error", () => undefined);
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
  windowSeconds: number
): Promise<RateLimitDecision> {
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, windowSeconds);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: windowSeconds };
}

function clientIp(c: Context): string {
  // Trust proxy headers first (the hosted deployment runs behind one), then fall
  // back to the socket address for direct/local connections.
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = c.req.header("x-real-ip");
  if (real) return real;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function rateLimit(opts: {
  limit: number;
  windowSeconds: number;
  prefix: string;
}): MiddlewareHandler {
  return async (c, next) => {
    if (DISABLED) return next();
    const key = `ratelimit:${opts.prefix}:${clientIp(c)}`;
    try {
      const { allowed, retryAfter } = await checkRateLimit(
        getClient(),
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
