import { setupI18n } from "@lingui/core";
import { setI18n } from "@lingui/react/server";
import { loadCatalog, type SupportedLocale } from "@amarnai/i18n";

// Activates Lingui for React Server Components for the current request.
//
// A fresh i18n instance is created per request rather than reusing the shared
// client singleton: the server handles many tenants/locales concurrently, and a
// single mutable instance would let one request's locale bleed into another's.
// `setI18n` stores the instance in React's per-request cache, so every server
// component rendered in this request (via `<Trans>` / `useLingui`) resolves
// against it.
export async function initServerI18n(locale: SupportedLocale) {
  const messages = await loadCatalog(locale);
  const i18n = setupI18n({ locale, messages: { [locale]: messages } });
  setI18n(i18n);
  return i18n;
}
