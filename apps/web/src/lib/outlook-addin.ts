// Outlook Office Add-in configuration.
//
// Mirrors the LABEL_WRITEBACK_ENABLED pattern in writeback-flag.ts: apps/web
// re-reads the raw env rather than importing @amarnai/config, so the web build
// does not pull the server config package in.

/** The path Outlook loads as the task pane, and the only path framed by Outlook. */
export const OUTLOOK_PANEL_PATH = "/outlook-panel";

/**
 * Hosts allowed to frame the task pane. Outlook on the web serves the add-in
 * from one of these depending on tenant and consumer/commercial account; the
 * officeapps.live.com wildcard covers the Office-hosted shims that new Outlook
 * for Windows and Mac load the pane through.
 */
export const OUTLOOK_FRAME_ANCESTORS = [
  "https://outlook.office.com",
  "https://outlook.office365.com",
  "https://outlook.live.com",
  "https://*.officeapps.live.com",
];

/** Where office.js itself is served from. Microsoft's CDN is the only supported source. */
export const OFFICE_JS_ORIGIN = "https://appsforoffice.microsoft.com";

/**
 * Off by default: the add-in is inert until a deployment opts in, because
 * enabling it widens the pane route's frame-ancestors. Server-only.
 */
export function isOutlookAddinEnabled(): boolean {
  return process.env["OUTLOOK_ADDIN_ENABLED"] === "true";
}

/**
 * The public origin this web app is reachable at, used to template absolute URLs
 * into the add-in manifest (Outlook fetches every resource by absolute URL, so a
 * relative path is not an option). Falls back to the dev origin.
 */
export function appBaseUrl(): string {
  const raw = process.env["APP_BASE_URL"] ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/**
 * The add-in Id Amarnai's own hosted deployment publishes under. Every other
 * deployment needs a different one.
 */
const DEFAULT_ADDIN_ID = "6f3a5b1e-9c24-4a7d-8f16-2b8d4e0c93a1";

/** A bare RFC 4122 UUID, which is the only form Outlook accepts as an <Id>. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The add-in's identity. Outlook keys installed add-ins by this value, so two
 * deployments sharing one Id cannot coexist in a mailbox: installing the second
 * replaces the first, silently. That makes it a per-deployment value, not a
 * constant — a self-hoster, and Amarnai's own staging environment, each need
 * their own.
 *
 * It must NEVER change for a deployment that has already published, which is
 * why this is settable at all: the Id is unfixable after publication, so the
 * seam has to exist before then. Amarnai's hosted deployment keeps the default
 * and must never set this.
 *
 * Generate one with `uuidgen` (or any UUID v4 source).
 */
export function outlookAddinId(): string {
  const raw = process.env["OUTLOOK_ADDIN_ID"]?.trim();
  if (!raw) return DEFAULT_ADDIN_ID;
  if (!UUID_PATTERN.test(raw)) {
    // Outlook rejects a malformed Id by refusing the whole manifest, with no
    // useful diagnostic. Fail here instead, where the cause is nameable.
    throw new Error(
      "OUTLOOK_ADDIN_ID must be a UUID (e.g. 6f3a5b1e-9c24-4a7d-8f16-2b8d4e0c93a1)",
    );
  }
  return raw;
}
