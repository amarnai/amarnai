import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Copy of apps/extension/vitest.config.ts. The Lingui macro plugin needs the
// shared config in packages/i18n so components using the macros transform at
// test time instead of pulling in babel-plugin-macros at runtime.
process.env["LINGUI_CONFIG"] = path.resolve(
  __dirname,
  "../../packages/i18n/lingui.config.ts",
);

export default defineConfig({
  plugins: [
    react({
      babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] },
    }),
  ],
  test: {
    // Node by default: the package's other tests read their own source off disk
    // via import.meta.url, which jsdom breaks. Component tests opt in with a
    // `// @vitest-environment jsdom` docblock.
    server: {
      deps: {
        inline: [/^@amarnai\//],
      },
    },
  },
});
