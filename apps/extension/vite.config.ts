import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The Lingui config lives in packages/i18n, not in this app. Point the macro
// plugin (via @lingui/conf) at it explicitly so it resolves at build time,
// mirroring apps/web/vitest.config.ts.
process.env["LINGUI_CONFIG"] = path.resolve(
  __dirname,
  "../../packages/i18n/lingui.config.ts",
);

// Panel build: the side-panel HTML app. The MV3 service worker is a separate
// entry built by vite.sw.config.ts (it must land at a fixed path with no shared
// hashed chunks). public/ (manifest.json + icons) is copied verbatim into dist/.
export default defineConfig({
  plugins: [
    react({
      babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] },
    }),
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
});
