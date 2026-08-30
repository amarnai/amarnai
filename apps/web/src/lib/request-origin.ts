/**
 * Base URL the user's browser can reach for return trips from external flows
 * (Stripe Checkout success/cancel, billing portal return).
 *
 * The browser arrived via the origin it used to reach us, so that origin is
 * reachable on the way back. This matters for native mobile: the app talks to a
 * LAN/dev host (e.g. http://192.168.1.147:3000), whereas AUTH_URL is typically
 * http://localhost:3000 in dev, which the phone cannot resolve. Honors proxy
 * headers in production; falls back to AUTH_URL when no host header is present.
 */
export function getReturnBaseUrl(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    // Dev hosts (localhost or an explicit :port) are plain HTTP; public hosts are HTTPS.
    const proto = forwardedProto ?? (host.includes("localhost") || /:\d+$/.test(host) ? "http" : "https");
    return `${proto}://${host}`;
  }
  return process.env.AUTH_URL ?? "https://app.aziru.email";
}
