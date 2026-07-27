import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GMAIL_MAIL_HOST, OUTLOOK_MAIL_HOSTS, MAIL_HOSTS } from "./src/platform/mailHosts";

const dir = path.dirname(fileURLToPath(import.meta.url));

export type BrowserTarget = "chrome" | "firefox";

// Firefox add-on id. It only looks like an email — it is a permanent, unique
// identifier, never a real mailbox. It is fixed forever because it (a) pins the
// AMO listing and (b) determines the OAuth redirect hash
// (https://<hash-of-id>.extensions.allizom.org/) registered on the Google client.
const FIREFOX_GECKO_ID = "amarnai@amarnai.com";
// ESR baseline. Covers MV3, module event pages, and install-time host-permission
// prompting. Firefox <140 ignores data_collection_permissions (warning at most).
const FIREFOX_MIN_VERSION = "128.0";

/**
 * Builds the MV3 manifest at build time so it always tracks the environment:
 *
 * - `host_permissions` is derived from the API origin, so it can never drift
 *   from VITE_API_URL. The panel's fetch/SSE are CORS-blocked if the API origin
 *   is missing here, so deriving it removes a manual-sync footgun.
 * - `version` is read from package.json, the single source of truth.
 * - `key`, when provided, pins a stable extension ID (a base64 DER public key;
 *   see README). It is injected only for signed/prod Chrome builds via the
 *   EXTENSION_KEY env var and is never committed. Firefox has no `key`; it pins
 *   its ID via browser_specific_settings.gecko.id instead.
 * - `browser` selects Chrome (side panel + service worker) or Firefox (sidebar +
 *   event page). The browsers diverge only in this manifest; the panel code is
 *   shared. The Chrome branch is byte-identical to the original single-target
 *   manifest.
 */
/**
 * Native thread-summary injection: one content script per provider, sharing the
 * host grants MAIL_HOSTS already asks for (no new permission surface). Declared
 * once and spread into both browser branches so the two can never diverge.
 * Omitted entirely when injection is disabled at build time.
 */
const CONTENT_SCRIPTS = [
  { matches: [GMAIL_MAIL_HOST], js: ["content-gmail.js"], run_at: "document_idle" },
  { matches: OUTLOOK_MAIL_HOSTS, js: ["content-outlook.js"], run_at: "document_idle" },
];

/**
 * Resources Gmail's own page is allowed to load from the extension, for the
 * "Amarnai Reply" button:
 *   - pageWorld.js: InboxSDK's page-world half, which it injects into Gmail.
 *   - the button icon, rendered by Gmail inside its compose tray.
 *
 * Scoped to Gmail alone rather than <all_urls>: every other site is still unable
 * to see that the extension is installed. Emitted only alongside the content
 * scripts, so a build with injection disabled exposes nothing.
 */
const WEB_ACCESSIBLE_RESOURCES = [
  { resources: ["pageWorld.js", "reply-button-icon.svg"], matches: [GMAIL_MAIL_HOST] },
];

/**
 * InboxSDK cannot cross into Gmail's own JS world from a content script: it asks
 * the background to inject pageWorld.js via chrome.scripting (MAIN world), which
 * requires this permission. Granted only when the content scripts ship — the
 * kill-switch build must not carry a permission it has no call site for. It
 * scopes to the host grants the manifest already holds and adds no install-time
 * warning of its own.
 */
const INJECTION_PERMISSIONS = ["scripting"];

export function buildManifest({
  apiUrl,
  key,
  browser = "chrome",
  nativeInjection = true,
}: {
  apiUrl: string;
  key?: string | undefined;
  browser?: BrowserTarget;
  /**
   * Build-time kill-switch (VITE_DISABLE_NATIVE_INJECTION=1). When false the
   * manifest declares no content scripts at all, so the build cannot touch mail
   * pages. The runtime toggle in the panel is the per-user equivalent.
   */
  nativeInjection?: boolean;
}) {
  const apiOrigin = new URL(apiUrl).origin;
  const { version } = JSON.parse(
    readFileSync(path.join(dir, "package.json"), "utf8"),
  ) as { version: string };

  const icons = {
    16: "icons/icon16.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  };
  // MAIL_HOSTS (Gmail + OWA) is shared with permissions.ts and openInGmail.ts so
  // the manifest grant can never drift from the runtime request or tab-reuse query.
  const hostPermissions = [`${apiOrigin}/*`, ...MAIL_HOSTS];

  if (browser === "firefox") {
    // Firefox has no side_panel/sidePanel and no MV3 background.service_worker: it
    // uses sidebar_action + an event-page background. `key` and
    // minimum_chrome_version are Chrome-only and intentionally omitted (the stable
    // ID comes from gecko.id).
    return {
      manifest_version: 3,
      name: "Amarnai: Sort emails your way",
      description:
        "Amarnai sorts your inbox, drafts replies for your approval, and takes you to any thread without leaving the tab.",
      version,
      action: { default_title: "Amarnai" },
      sidebar_action: {
        default_panel: "index.html",
        default_title: "Amarnai",
        default_icon: icons,
      },
      background: { scripts: ["service-worker.js"], type: "module" },
      permissions: [
        "storage",
        "identity",
        "clipboardWrite",
        ...(nativeInjection ? INJECTION_PERMISSIONS : []),
      ],
      host_permissions: hostPermissions,
      ...(nativeInjection
        ? {
            content_scripts: CONTENT_SCRIPTS,
            web_accessible_resources: WEB_ACCESSIBLE_RESOURCES,
          }
        : {}),
      browser_specific_settings: {
        gecko: {
          id: FIREFOX_GECKO_ID,
          strict_min_version: FIREFOX_MIN_VERSION,
          // Required for new AMO submissions. OAuth code + session tokens are sent
          // to the API. Verify the category list against current AMO policy before
          // the first submission (Gmail-content processing may need more).
          data_collection_permissions: { required: ["authenticationInfo"] },
        },
      },
      icons,
    };
  }

  // Chrome — byte-identical to the original single-target manifest.
  return {
    manifest_version: 3,
    name: "Amarnai: Sort emails your way",
    description:
      "Amarnai sorts your inbox, drafts replies for your approval, and takes you to any thread without leaving the tab.",
    ...(key ? { key } : {}),
    version,
    minimum_chrome_version: "116",
    action: { default_title: "Amarnai" },
    side_panel: { default_path: "index.html" },
    background: { service_worker: "service-worker.js", type: "module" },
    permissions: [
      "sidePanel",
      "storage",
      "identity",
      "clipboardWrite",
      ...(nativeInjection ? INJECTION_PERMISSIONS : []),
    ],
    host_permissions: hostPermissions,
    ...(nativeInjection
      ? {
          content_scripts: CONTENT_SCRIPTS,
          web_accessible_resources: WEB_ACCESSIBLE_RESOURCES,
        }
      : {}),
    icons,
  };
}
