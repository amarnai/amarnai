// Shared test helpers for API route tests.
// INTERNAL_API_SECRET is not set in the test environment, so the config module
// falls back to "dev-internal-secret". All app.request calls must include this
// header or the auth middleware returns 401.
//
// requireWorkspaceMember (app.ts) also requires X-User-Id. TEST_USER_ID is the
// canonical authenticated user for unit tests; each test's beforeEach should
// mock db.workspaceMember.findUnique to return a member for this userId.

export const INTERNAL_TOKEN = "dev-internal-secret";
export const TEST_USER_ID = "test-user-1";

// Pass userId=null to omit X-User-Id entirely (e.g. when testing the no-user code path).
export function authed(init: RequestInit = {}, userId: string | null = TEST_USER_ID): RequestInit {
  const existing =
    init.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : ((init.headers as Record<string, string> | undefined) ?? {});
  const headers: Record<string, string> = {
    ...existing,
    Authorization: `Bearer ${INTERNAL_TOKEN}`,
  };
  if (userId !== null) {
    headers["X-User-Id"] = userId;
  }
  return { ...init, headers };
}
