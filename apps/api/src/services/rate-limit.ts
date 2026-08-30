import { getConnInfo } from "@hono/node-server/conninfo";
import { config } from "@aziru/config";
import type { Context, MiddlewareHandler } from "hono";
import {
  RATE_LIMIT_DISABLED,
  getRateLimitClient,
  checkRateLimit,
} from "@aziru/auth/rate-limit-store";

// The counter store and its primitives now live in @aziru/auth so the web
// server-action throttles share the exact same Redis-backed, fail-open limiter
// (previously the web used a per-instance in-memory map, which diverged across
// replicas). This module keeps only the Hono-specific pieces: client-IP
// derivation and the middleware wrapper.
export { checkRateLimit, throttleOnce } from "@aziru/auth/rate-limit-store";
export type { RateLimitStore, RateLimitDecision } from "@aziru/auth/rate-limit-store";

function socketIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

// Warn once per process if a request arrives with a forwarding header while
// TRUST_PROXY is 0 in production. That is the collective-lockout footgun: behind
// a load balancer the socket address is the proxy, so every user shares one
// bucket. We do NOT change behavior off the header (it is attacker-controlled, so
// trusting it would let a direct caller dodge the limit) — the operator must set
// TRUST_PROXY. The startup gate in @aziru/config already forces a value in
// production; this catches a deployment that set it to 0 behind a real proxy.
let warnedAboutProxy = false;
function warnIfProxyHeaderIgnored(c: Context): void {
  if (warnedAboutProxy || process.env["NODE_ENV"] !== "production") return;
  if (c.req.header("x-forwarded-for") || c.req.header("x-real-ip")) {
    warnedAboutProxy = true;
    console.warn(
      "[rate-limit] TRUST_PROXY=0 but requests carry X-Forwarded-For; if the API " +
        "runs behind a proxy, all clients share one rate-limit bucket. Set TRUST_PROXY " +
        "to the number of trusted proxies.",
    );
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
  if (trustProxy <= 0) {
    warnIfProxyHeaderIgnored(c);
    return socketIp(c);
  }

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
    if (RATE_LIMIT_DISABLED) return next();
    const store = getRateLimitClient();
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
        opts.windowSeconds,
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
