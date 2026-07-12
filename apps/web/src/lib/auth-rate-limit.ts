import { headers } from "next/headers";
import { checkAndCount, peekCount, incrementCount, clearKey } from "@amarnai/auth/rate-limit-store";

// Per-account/per-IP throttles for the public auth server actions (register,
// forgot-password, credentials sign-in). These run in the web server and go
// straight through next-auth, so the API's /auth/* limiter does not cover them;
// without this they are an unthrottled email-amplification / brute-force surface.
//
// Counters live in the SHARED Redis store (@amarnai/auth/rate-limit-store), so the
// limit holds across web instances and shares the API's fail-open policy — a
// rate-limit outage never blocks a legitimate sign-in. (This replaced a
// per-instance in-memory map that diverged across replicas.)

const WINDOW_SECONDS = 15 * 60;

// Trusted reverse-proxy count, same knob as the API (TRUST_PROXY). Read from the
// env here so this module need not depend on @amarnai/config. 0 (default) means no
// forwarded header is trusted for IP derivation.
function trustProxyCount(): number {
  const n = Number.parseInt(process.env["TRUST_PROXY"] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The client IP, only when a trusted-proxy count is configured. A Next server
// action has no socket handle, so with TRUST_PROXY=0 there is no spoof-proof IP to
// key on and we fall back to the per-email bucket alone.
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

// Records an attempt and returns true if the action should be blocked. COUNT-ALL:
// every call increments, because for register / forgot-password the attempt
// itself is the cost (an email send). Trips on either the per-email bucket or,
// when a trusted-proxy IP is available, a wider per-IP bucket. No-op under tests.
export async function authActionRateLimited(
  action: string,
  email: string,
  limit: number,
): Promise<boolean> {
  if (process.env.NODE_ENV === "test") return false;

  const key = email.trim().toLowerCase();
  const ip = await trustedClientIp();
  // Record on both buckets regardless of which trips first (count-all semantics).
  const [emailLimited, ipLimited] = await Promise.all([
    checkAndCount(`auth:${action}:email:${key}`, limit, WINDOW_SECONDS),
    ip ? checkAndCount(`auth:${action}:ip:${ip}`, limit * 4, WINDOW_SECONDS) : Promise.resolve(false),
  ]);
  return emailLimited || ipLimited;
}

// ─── Login throttle (failures-only) ───────────────────────────────────────────
//
// Login must NOT hard-lock on wrong-password volume: an attacker sending bad
// passwords for a victim's email could otherwise lock the real user out. So login
// counts FAILURES only — checked before the attempt (no increment), recorded after
// a failure, cleared on success:
//   - (ip, email): strict, the brute-force stopper. Un-DoS-able because the
//     attacker's own IP is in the key; only exists when a trusted IP is available.
//   - email: a high-threshold backstop against a distributed (many-IP) brute
//     force. Its ceiling is the irreducible per-account DoS surface when no
//     trusted IP is available (self-host TRUST_PROXY=0); the victim still has
//     Google sign-in and password reset (separate buckets).
//   - ip (wide): one host fanning failures across many victim emails.
export const LOGIN_IP_EMAIL_LIMIT = 10;
export const LOGIN_EMAIL_LIMIT = 30;
export const LOGIN_IP_LIMIT = 40;

// Key builders are exported so tests can assert the composition that makes the
// throttle un-DoS-able: the (ip, email) key includes the ATTACKER's IP, so a
// victim signing in from a different IP hits a different key (count 0) and only
// shares the high-threshold email backstop.
export function loginEmailKey(email: string): string {
  return `auth:login:email:${email.trim().toLowerCase()}`;
}
export function loginIpEmailKey(ip: string, email: string): string {
  return `auth:login:ipemail:${ip}:${email.trim().toLowerCase()}`;
}
export function loginIpKey(ip: string): string {
  return `auth:login:ip:${ip}`;
}

// Pure block decision from the three counters, so the security-critical
// thresholds are unit-testable without Redis or a request scope. A wrong-password
// flood from one host trips its own (ip, email) bucket, never the victim's.
export function isLoginBlockedByCounts(
  emailCount: number,
  ipEmailCount: number,
  ipCount: number,
): boolean {
  return (
    emailCount >= LOGIN_EMAIL_LIMIT ||
    ipEmailCount >= LOGIN_IP_EMAIL_LIMIT ||
    ipCount >= LOGIN_IP_LIMIT
  );
}

// True if the credentials login should be refused BEFORE attempting it. Reads the
// counters without incrementing, so a legitimate user is never pushed over by the
// act of checking. Fails open (peekCount returns 0) when the store is unavailable.
export async function isLoginBlocked(email: string): Promise<boolean> {
  if (process.env.NODE_ENV === "test") return false;

  const ip = await trustedClientIp();
  const [emailCount, ipEmailCount, ipCount] = await Promise.all([
    peekCount(loginEmailKey(email)),
    ip ? peekCount(loginIpEmailKey(ip, email)) : Promise.resolve(0),
    ip ? peekCount(loginIpKey(ip)) : Promise.resolve(0),
  ]);
  return isLoginBlockedByCounts(emailCount, ipEmailCount, ipCount);
}

// Records one failed login attempt across the buckets above.
export async function recordLoginFailure(email: string): Promise<void> {
  if (process.env.NODE_ENV === "test") return;

  const ip = await trustedClientIp();
  await Promise.all([
    incrementCount(loginEmailKey(email), WINDOW_SECONDS),
    ip ? incrementCount(loginIpEmailKey(ip, email), WINDOW_SECONDS) : Promise.resolve(),
    ip ? incrementCount(loginIpKey(ip), WINDOW_SECONDS) : Promise.resolve(),
  ]);
}

// Clears the account-scoped login counters on a real success, so a user who
// mistyped a few times is not left throttled. The wide per-IP bucket is
// deliberately NOT cleared — one successful login must not reset an attacker's
// cross-account fan-out.
export async function clearLoginFailures(email: string): Promise<void> {
  if (process.env.NODE_ENV === "test") return;

  const ip = await trustedClientIp();
  await Promise.all([
    clearKey(loginEmailKey(email)),
    ip ? clearKey(loginIpEmailKey(ip, email)) : Promise.resolve(),
  ]);
}
