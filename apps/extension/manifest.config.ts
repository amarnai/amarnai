import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the MV3 manifest at build time so it always tracks the environment:
 *
 * - `host_permissions` is derived from the API origin, so it can never drift
 *   from VITE_API_URL. The panel's fetch/SSE are CORS-blocked if the API origin
 *   is missing here, so deriving it removes a manual-sync footgun.
 * - `version` is read from package.json, the single source of truth.
 * - `key`, when provided, pins a stable extension ID (a base64 DER public key;
 *   see README). It is injected only for signed/prod builds via the
 *   EXTENSION_KEY env var and is never committed.
 */
export function buildManifest({
  apiUrl,
  key,
}: {
  apiUrl: string;
  key?: string | undefined;
}) {
  const apiOrigin = new URL(apiUrl).origin;
  const { version } = JSON.parse(
    readFileSync(path.join(dir, "package.json"), "utf8"),
  ) as { version: string };

  return {
    manifest_version: 3,
    name: "Amarnai: AI Triage for Gmail",
    description:
      "Amarnai sorts your Gmail, drafts replies for your approval, and takes you to any thread without leaving the tab.",
    ...(key ? { key } : {}),
    version,
    minimum_chrome_version: "116",
    action: { default_title: "Amarnai" },
    side_panel: { default_path: "index.html" },
    background: { service_worker: "service-worker.js", type: "module" },
    permissions: ["sidePanel", "storage", "identity", "clipboardWrite"],
    host_permissions: [`${apiOrigin}/*`, "https://mail.google.com/*"],
    icons: {
      16: "icons/icon16.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  };
}
