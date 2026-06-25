import { defineConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";
import { SUPPORTED_LOCALES, SOURCE_LOCALE } from "./src/locales.js";

export default defineConfig({
  sourceLocale: SOURCE_LOCALE,
  locales: SUPPORTED_LOCALES,
  format: formatter(),
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: [
        "<rootDir>/../../apps/site/src",
        "<rootDir>/../../apps/web/src",
        "<rootDir>/../../apps/mobile/app",
        "<rootDir>/../../apps/mobile/src",
        "<rootDir>/../../packages/ui/src",
      ],
    },
  ],
  compileNamespace: "es",
});
