import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { buildManifest, type BrowserTarget } from "./manifest.config";

// Build target selected via EXT_BROWSER (a build-target flag, deliberately not in
// .env — it is not configuration). Firefox output goes to dist-firefox/ so the
// Chrome build in dist/ is never touched. Shared by this config and vite.sw.config.ts.
export const EXT_BROWSER: BrowserTarget =
  process.env["EXT_BROWSER"] === "firefox" ? "firefox" : "chrome";
export const OUT_DIR = EXT_BROWSER === "firefox" ? "dist-firefox" : "dist";

// The Lingui config lives in packages/i18n, not in this app. Point the macro
// plugin (via @lingui/conf) at it explicitly so it resolves at build time,
// mirroring apps/web/vitest.config.ts.
process.env["LINGUI_CONFIG"] = path.resolve(
  __dirname,
  "../../packages/i18n/lingui.config.ts",
);

// Emits dist/manifest.json generated from the environment (see manifest.config.ts).
// This replaces a static public/manifest.json so host_permissions always matches
// VITE_API_URL.
//
// The top-level "key" (from EXTENSION_KEY) is injected only for non-production
// builds. It pins a stable ID for *unpacked* loads, but the Chrome Web Store
// rejects any package that contains "key" (it re-signs and assigns the canonical
// ID itself), so a production/store build must omit it.
function emitManifest(env: Record<string, string>, mode: string): Plugin {
  return {
    name: "amarnai-emit-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(
          buildManifest({
            apiUrl: env["VITE_API_URL"] ?? "http://localhost:3001",
            key:
              mode === "production"
                ? undefined
                : env["EXTENSION_KEY"] || undefined,
            browser: EXT_BROWSER,
          }),
          null,
          2,
        ),
      });
    },
  };
}

// Panel build: the side-panel HTML app. The MV3 service worker is a separate
// entry built by vite.sw.config.ts (it must land at a fixed path with no shared
// hashed chunks). public/icons is copied verbatim into dist/; the manifest is
// emitted by emitManifest (not a static file), so it stays env-aware.
export default defineConfig(({ mode }) => {
  // Empty prefix loads all vars (incl. non-VITE_ EXTENSION_KEY) from .env files.
  const env = loadEnv(mode, __dirname, "");
  return {
    plugins: [
      react({
        babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] },
      }),
      emitManifest(env, mode),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: OUT_DIR,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          panel: path.resolve(__dirname, "index.html"),
        },
      },
    },
  };
});
