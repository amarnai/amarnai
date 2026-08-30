/** Cookie carrying a pending workspace-invite accept path across the auth flow. */
export const INVITE_COOKIE = "aziru-invite";

/**
 * The pending-invite cookie is only ever set by the accept route to its own
 * path. Validate on read so the value can never be turned into an open redirect,
 * falling back to the app home when there is no valid pending invite.
 */
export function sanitizeInvitePath(raw: string | null | undefined): string {
  return raw?.startsWith("/api/workspace-invite/accept?token=") ? raw : "/emails";
}
