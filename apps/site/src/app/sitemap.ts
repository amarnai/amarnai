import type { MetadataRoute } from "next";
import { SUPPORTED_LOCALES, SOURCE_LOCALE } from "@aziru/i18n";
import { localeUrl } from "@/lib/seo";

// Emitted as a static /sitemap.xml by the export build.
export const dynamic = "force-static";

// Public, localized routes. The source locale is served at the bare domain and
// other locales under `/{locale}`; each entry lists every locale as an hreflang
// alternate so crawlers discover the translations.
const PATHS = ["", "pricing", "privacy", "terms", "delete-account", "support"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({
    url: localeUrl(SOURCE_LOCALE, path),
    alternates: {
      languages: Object.fromEntries(
        SUPPORTED_LOCALES.map((l) => [l, localeUrl(l, path)])
      ),
    },
  }));
}
