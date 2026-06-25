import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// The Lingui config lives in packages/i18n, not in this app. Point the macro
// plugin (via @lingui/conf) at it explicitly so it can resolve at test time.
process.env.LINGUI_CONFIG = path.resolve(
  __dirname,
  "../../packages/i18n/lingui.config.ts",
);

export default defineConfig({
  // Transform Lingui macros (@lingui/*/macro) the same way the Next build does
  // via @lingui/swc-plugin. Without this, importing a component that uses the
  // macros pulls in babel-plugin-macros at runtime (not installed) and the
  // macro throws "executed outside the context of compilation". plugin-react
  // also handles JSX, so the esbuild jsx settings above are no longer needed.
  plugins: [
    react({
      babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    server: {
      deps: {
        inline: [/^@amarnai\//],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
