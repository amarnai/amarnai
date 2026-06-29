import { i18n, type Messages } from "@lingui/core";
import { type SupportedLocale } from "./locales.js";

// Dynamic, code-split catalog loading for bundlers that support it (Next/webpack
// on web + site, tsx/Node in the worker). React Native / Metro cannot transform
// the template-literal dynamic import below; it uses load-catalog.native.ts and
// the static require-map in i18n.ts (registerMobileMessages/activateLocaleMobile).

// Loads a compiled catalog without touching any shared i18n instance.
// Server-side rendering must build a fresh, per-request i18n instance (so
// concurrent requests/tenants never share an activated locale), so it needs
// the raw messages rather than activating the singleton.
export async function loadCatalog(locale: SupportedLocale): Promise<Messages> {
  const { messages } = await import(
    /* webpackMode: "lazy" */
    `./locales/${locale}/messages.mjs`
  );
  return messages;
}

// Dynamic catalog loader for web (code-split per locale).
// Mobile uses activateLocaleMobile() instead (static require-map).
export async function activateLocale(locale: SupportedLocale): Promise<void> {
  const messages = await loadCatalog(locale);
  i18n.loadAndActivate({ locale, messages });
}
