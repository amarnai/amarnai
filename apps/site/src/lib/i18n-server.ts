import { cache } from "react";
import { setupI18n, type I18n } from "@lingui/core";
import { setI18n } from "@lingui/react/server";
import {
  loadCatalog,
  isSupportedLocale,
  SOURCE_LOCALE,
  type SupportedLocale,
} from "@amarnai/i18n";

// Coerces an arbitrary route param into a supported locale, falling back to the
// source locale. The marketing site is rendered per-locale (one static segment
// per entry in SUPPORTED_LOCALES), so the locale always arrives via the route
// param rather than a request header like the web app's proxy-set `x-locale`.
export function resolveLocale(locale: string): SupportedLocale {
  return isSupportedLocale(locale) ? locale : SOURCE_LOCALE;
}

// Builds a per-locale i18n instance, memoised for the lifetime of the render via
// React's `cache` (keyed by the locale argument). A fresh instance per locale is
// created rather than mutating the shared client singleton: server rendering may
// build several locales concurrently, and a single mutable instance would let
// one segment's locale bleed into another's.
const buildServerI18n = cache(async (locale: SupportedLocale): Promise<I18n> => {
  const messages = await loadCatalog(locale);
  return setupI18n({ locale, messages: { [locale]: messages } });
});

// Activates Lingui for React Server Components in the current render.
//
// `setI18n` stores the instance in React's per-request cache, so every server
// component rendered afterwards (via `<Trans>` / `useLingui`) resolves against
// it. Call this at the top of every server segment that renders Lingui macros:
// Next.js renders layout and page segments concurrently and reuses layouts
// across navigations, so a single `setI18n` in the root layout is not guaranteed
// to have run before a page segment renders `<Trans>`. The returned instance is
// also used directly for imperative strings (metadata, attributes) via `i18n._`.
export async function initServerI18n(locale: SupportedLocale): Promise<I18n> {
  const i18n = await buildServerI18n(locale);
  setI18n(i18n);
  return i18n;
}
