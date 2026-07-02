import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { buildManifest } from "./manifest.config";

// The Lingui config lives in packages/i18n, not in this app. Point the macro
// plugin (via @lingui/conf) at it explicitly so it resolves at build time,
// mirroring apps/web/vitest.config.ts.
process.env["LINGUI_CONFIG"] = path.resolve(
  __dirname,
  "../../packages/i18n/lingui.config.ts",
);

// Emits dist/manifest.json generated from the environment (see manifest.config.ts).
// This replaces a static public/manifest.json so host_permissions always matches
// VITE_API_URL and the prod build can inject a pinned extension key.
function emitManifest(env: Record<string, string>): Plugin {
  return {
    name: "amarnai-emit-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(
          buildManifest({
            apiUrl: env["VITE_API_URL"] ?? "http://localhost:3001",
            key: env["EXTENSION_KEY"] || undefined,
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
      emitManifest(env),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          panel: path.resolve(__dirname, "index.html"),
        },
      },
    },
  };
});
