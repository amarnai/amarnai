import { API_BASE_URL } from "../config";
import type { MailScopePolicy } from "@amarnai/shared";

// Type-only import: it emits no runtime bytes, which keeps zod out of the panel
// bundle for the sake of one boolean. The shape is validated by hand below.

/** Give up quickly — this sits in front of a user's sign-in click. */
const TIMEOUT_MS = 2500;

/**
 * Cached policy, successes only. A failure is never cached: one network blip
 * would otherwise strand the user in read-only for the whole panel session, and
 * the next click should get a fresh answer.
 */
let cached: boolean | undefined;

/**
 * Whether this deployment wants the mail write scope requested at sign-in.
 *
 * The extension cannot read LABEL_WRITEBACK_ENABLED (server-side config) and the
 * settings endpoint that exposes it is workspace-scoped, so unreachable before
 * sign-in. Hence a small public endpoint.
 *
 * Failure resolves FALSE, never true. Asking for a scope the deployment has
 * switched off trips Google's unverified-scope warning, and the Outlook write
 * scopes can hit tenant admin-consent restrictions that would turn a working
 * read-only sign-in into a hard failure. Read-only is the safe default: the user
 * still signs in, and can grant writeback later from settings.
 */
export async function isWritebackAvailable(): Promise<boolean> {
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}/auth/mail-scope-policy`, {
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as Partial<MailScopePolicy>;
    if (typeof body.writebackAvailable !== "boolean") return false;
    cached = body.writebackAvailable;
    return cached;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Warm the cache so the sign-in click does not wait on the network. Called from
 * the sign-in screen's mount; deliberately fire-and-forget.
 */
export function prefetchWritebackPolicy(): void {
  void isWritebackAvailable();
}

/** Test seam: drop the memoized policy. */
export function resetWritebackPolicyCache(): void {
  cached = undefined;
}
