/**
 * Destinations the extension may hand to /auth/bridge. The `next` value arrives
 * in a URL the panel builds, so it is validated against this allowlist on read
 * rather than trusted: an unchecked value would turn the bridge into an open
 * redirect that any page could aim anywhere. Prefixes are matched exactly at the
 * start, and each entry is either a full path or a path that legitimately carries
 * a query string.
 */
const ALLOWED_PREFIXES = [
  "/emails",
  "/folders",
  "/settings",
  "/account",
  "/notifications",
  "/upgrade",
] as const;

/** Where a bridge with no usable destination lands. */
export const BRIDGE_DEFAULT_PATH = "/emails";

/**
 * Validate a bridge destination. Returns the path when it is one the panel is
 * allowed to send users to, and the app home otherwise.
 *
 * Rejects anything that is not a same-origin absolute path, including
 * protocol-relative URLs ("//evil.com") and backslash variants that some URL
 * parsers normalize into a host.
 */
export function sanitizeBridgePath(raw: string | null | undefined): string {
  if (!raw) return BRIDGE_DEFAULT_PATH;
  if (!raw.startsWith("/")) return BRIDGE_DEFAULT_PATH;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return BRIDGE_DEFAULT_PATH;

  const path = raw.split(/[?#]/)[0] ?? "";
  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
  return allowed ? raw : BRIDGE_DEFAULT_PATH;
}
