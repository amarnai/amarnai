import { headers } from "next/headers";
import { isRateLimited } from "./rate-limit";

// Trusted reverse-proxy count, same knob as the API (TRUST_PROXY). Read straight
// from the env here so the web app need not depend on @amarnai/config. 0 (default)
// means no header is trusted for IP derivation.
function trustProxyCount(): number {
  const n = Number.parseInt(process.env["TRUST_PROXY"] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Per-account/per-IP throttle for the public auth server actions (register,
// forgot-password, credentials sign-in). These run in the web server and never
// touch the API, so the API's Redis limiter does not cover them; without this
// they are an unthrottled email-amplification / brute-force surface (N12).
//
// Buckets are in-memory (per web instance) — see rate-limit.ts. That is weak
// across a multi-instance deployment but adequate for low-stakes abuse control,
// and the per-email bucket (below) does not depend on IP resolution at all.
const WINDOW_MS = 15 * 60 * 1000;

// The client IP, only when a trusted-proxy count is configured. A Next server
// action has no socket handle, so with TRUST_PROXY=0 there is no spoof-proof IP
// to key on and we fall back to the per-email bucket alone.
async function trustedClientIp(): Promise<string | null> {
  const trustProxy = trustProxyCount();
  if (trustProxy <= 0) return null;
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const idx = parts.length - trustProxy;
    if (idx >= 0 && idx < parts.length) return parts[idx]!;
  }
  return h.get("x-real-ip")?.trim() ?? null;
}

// Records an attempt and returns true if the action should be blocked. Trips on
// either the per-email bucket (stops bombing one inbox / brute-forcing one
// account) or, when a trusted-proxy IP is available, a wider per-IP bucket (stops
// fanning the same abuse across many emails from one host). No-op under tests.
export async function authActionRateLimited(
  action: string,
  email: string,
  limit: number
): Promise<boolean> {
  if (process.env.NODE_ENV === "test") return false;

  const key = email.trim().toLowerCase();
  let limited = isRateLimited(`${action}:email:${key}`, limit, WINDOW_MS);

  const ip = await trustedClientIp();
  if (ip) {
    limited = isRateLimited(`${action}:ip:${ip}`, limit * 4, WINDOW_MS) || limited;
  }
  return limited;
}
