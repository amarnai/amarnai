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
