import {
  isOutlookAddinEnabled,
  OFFICE_JS_ORIGIN,
  OUTLOOK_FRAME_ANCESTORS,
  OUTLOOK_PANEL_PATH,
} from "./outlook-addin";

// Content-Security-Policy construction.
//
// The policy is nonce-based and is the primary XSS mitigation: every request gets a
// fresh nonce (generated in proxy.ts) which is attached to the one inline script we
// ship (the theme bootstrap in layout.tsx) and, automatically by Next.js, to its own
// bundled scripts. `'strict-dynamic'` then lets those trusted scripts load the chunks
// they need without host allowlisting. An injected <script> that lacks the per-request
// nonce will not execute.

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Report-Only mode ships the policy without enforcing it: browsers report what the
// policy *would* have blocked (to the console, and to CSP_REPORT_URI if set) but let
// it load. Use it to roll out or tighten the policy without risking a broken page for
// users, then unset CSP_REPORT_ONLY to enforce.
export function cspHeaderName(): "Content-Security-Policy-Report-Only" | "Content-Security-Policy" {
  return process.env.CSP_REPORT_ONLY === "true"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
}

/**
 * The Outlook task pane is the one route that must be framable and must load a
 * third-party script (office.js). The exception is scoped to that path alone
 * rather than relaxed globally, so every other page keeps `frame-ancestors
 * 'none'` and a script-src with no third-party origins.
 */
function isOutlookPanelPath(pathname: string | undefined): boolean {
  if (!pathname) return false;
  return (
    isOutlookAddinEnabled() &&
    (pathname === OUTLOOK_PANEL_PATH || pathname.startsWith(`${OUTLOOK_PANEL_PATH}/`))
  );
}

export function buildContentSecurityPolicy(nonce: string, pathname?: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const isOutlookPanel = isOutlookPanelPath(pathname);

  // Analytics (Umami) is optional and self-configured. When set, its script is
  // rendered through next/script so it inherits the nonce and is covered by
  // 'strict-dynamic'; but its beacon endpoint must be allowed for connect-src, and we
  // list the origin in script-src as a fallback for browsers that ignore
  // 'strict-dynamic'.
  const umamiOrigin = originOf(process.env.NEXT_PUBLIC_UMAMI_SRC);

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    umamiOrigin,
    // Next.js dev + React Fast Refresh compile and eval on the client.
    isDev ? "'unsafe-eval'" : null,
    // office.js is loaded from Microsoft's CDN by URL, so it carries no nonce and
    // 'strict-dynamic' does not cover it.
    isOutlookPanel ? OFFICE_JS_ORIGIN : null,
  ];

  const connectSrc = [
    "'self'",
    umamiOrigin,
    // Webpack HMR websocket in dev.
    isDev ? "ws:" : null,
    isDev ? "wss:" : null,
    // The pane talks to the API directly with a bearer token: it cannot use the
    // /api/internal cookie proxy, whose session cookie is third-party inside an
    // Outlook frame and would be partitioned away.
    isOutlookPanel ? originOf(process.env.NEXT_PUBLIC_API_URL) : null,
  ];

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src ${scriptSrc.filter(Boolean).join(" ")}`,
    // next/font and some libraries inject inline <style>; nonces do not reliably cover
    // them, so styles fall back to 'unsafe-inline'. Style injection is a far weaker
    // vector than script execution.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.filter(Boolean).join(" ")}`,
    "frame-src 'none'",
    isOutlookPanel
      ? `frame-ancestors ${OUTLOOK_FRAME_ANCESTORS.join(" ")}`
      : "frame-ancestors 'none'",
    "form-action 'self'",
  ];

  if (!isDev) directives.push("upgrade-insecure-requests");

  // Optional collector for violation reports (works in both enforce and report-only
  // modes). `report-uri` is deprecated but still the most broadly supported directive
  // and needs no companion Reporting-Endpoints header.
  const reportUri = process.env.CSP_REPORT_URI;
  if (reportUri) directives.push(`report-uri ${reportUri}`);

  return directives.join("; ");
}

// Per-request nonce for the CSP. Uses Web Crypto so it runs on the Edge runtime.
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
