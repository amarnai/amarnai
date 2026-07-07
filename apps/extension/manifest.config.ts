import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
export function buildManifest({
  apiUrl,
  key,
  browser = "chrome",
}: {
  apiUrl: string;
  key?: string | undefined;
  browser?: BrowserTarget;
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
  const hostPermissions = [
    `${apiOrigin}/*`,
    "https://mail.google.com/*",
    "https://outlook.office.com/*",
  ];

  if (browser === "firefox") {
    // Firefox has no side_panel/sidePanel and no MV3 background.service_worker: it
    // uses sidebar_action + an event-page background. `key` and
    // minimum_chrome_version are Chrome-only and intentionally omitted (the stable
    // ID comes from gecko.id).
    return {
      manifest_version: 3,
      name: "Amarnai: Gmail, sorted your way",
      description:
        "Amarnai sorts your Gmail, drafts replies for your approval, and takes you to any thread without leaving the tab.",
      version,
      action: { default_title: "Amarnai" },
      sidebar_action: {
        default_panel: "index.html",
        default_title: "Amarnai",
        default_icon: icons,
      },
      background: { scripts: ["service-worker.js"], type: "module" },
      permissions: ["storage", "identity", "clipboardWrite"],
      host_permissions: hostPermissions,
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
    name: "Amarnai: Gmail, sorted your way",
    description:
      "Amarnai sorts your Gmail, drafts replies for your approval, and takes you to any thread without leaving the tab.",
    ...(key ? { key } : {}),
    version,
    minimum_chrome_version: "116",
    action: { default_title: "Amarnai" },
    side_panel: { default_path: "index.html" },
    background: { service_worker: "service-worker.js", type: "module" },
    permissions: ["sidePanel", "storage", "identity", "clipboardWrite"],
    host_permissions: hostPermissions,
    icons,
  };
}
