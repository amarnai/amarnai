// Turns any thrown value into a message safe to show an end user.
//
// Three classes of error reach the UI:
//  1. Low-level fetch failures (no connection, DNS, timeout). React Native
//     throws `TypeError: Network request failed`; undici throws `fetch failed`.
//     Neither is actionable, so we replace them with a connectivity hint.
//  2. Internal api-client diagnostics like "API /workspaces returned 500",
//     which leak the route and status. These are not written for users, so we
//     fall back to the caller's domain-specific message.
//  3. Our own throws and the API's `error` field, both authored for end users
//     and surfaced verbatim.
const NETWORK_MESSAGE =
  'Could not reach the server. Please check your connection and try again.';

const NETWORK_HINTS = ['Network request failed', 'fetch failed', 'Network Error'];

// Matches the api-client's no-error-body fallback, e.g. "API /auth/me returned 502".
const INTERNAL_API_ERROR = /^API\b.*\breturned \d+$/;

export function toUserMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const message = err.message.trim();
  if (!message) return fallback;
  if (NETWORK_HINTS.some((hint) => message.includes(hint))) return NETWORK_MESSAGE;
  if (INTERNAL_API_ERROR.test(message)) return fallback;
  return message;
}
