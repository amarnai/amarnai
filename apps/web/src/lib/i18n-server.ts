import { cache } from "react";
import { headers } from "next/headers";
import { setupI18n } from "@lingui/core";
import { setI18n } from "@lingui/react/server";
import {
  loadCatalog,
  isSupportedLocale,
  SOURCE_LOCALE,
  type SupportedLocale,
} from "@amarnai/i18n";

// Resolves the request locale from the `x-locale` header set by proxy.ts.
export async function getRequestLocale(): Promise<SupportedLocale> {
  const headersList = await headers();
  const localeHeader = headersList.get("x-locale") ?? SOURCE_LOCALE;
  return isSupportedLocale(localeHeader) ? localeHeader : SOURCE_LOCALE;
}

// Builds the per-request i18n instance, memoised for the lifetime of the
// request via React's `cache`. A fresh instance is created per request rather
// than reusing the shared client singleton: the server handles many
// tenants/locales concurrently, and a single mutable instance would let one
// request's locale bleed into another's. `cache` ensures the catalog is loaded
// only once even when several route segments ask for it.
const buildServerI18n = cache(async () => {
  const locale = await getRequestLocale();
  const messages = await loadCatalog(locale);
  return setupI18n({ locale, messages: { [locale]: messages } });
});

// Activates Lingui for React Server Components in the current request.
//
// `setI18n` stores the instance in React's per-request cache, so every server
// component rendered afterwards (via `<Trans>` / `useLingui`) resolves against
// it. This MUST be called at the top of every server page that renders Lingui
// macros: Next.js renders layout and page segments concurrently and reuses
// layouts across soft navigations, so a single `setI18n` in the root layout is
// not guaranteed to have run before a page segment renders `<Trans>`.
export async function initServerI18n() {
  const i18n = await buildServerI18n();
  setI18n(i18n);
  return i18n;
}
