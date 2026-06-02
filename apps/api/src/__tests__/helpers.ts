// Shared test helpers for API route tests.
// INTERNAL_API_SECRET is not set in the test environment, so the config module
// falls back to "dev-internal-secret". All app.request calls must include this
// header or the auth middleware returns 401.

export const INTERNAL_TOKEN = "dev-internal-secret";

export function authed(init: RequestInit = {}): RequestInit {
  const existing =
    init.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : ((init.headers as Record<string, string> | undefined) ?? {});
  return { ...init, headers: { ...existing, Authorization: `Bearer ${INTERNAL_TOKEN}` } };
}
