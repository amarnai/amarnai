import { i18n, type Messages } from "@lingui/core";
import { type SupportedLocale, SOURCE_LOCALE } from "./locales.js";

export { i18n };

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
// Mobile uses loadCatalogMobile() instead (static require-map).
export async function activateLocale(locale: SupportedLocale): Promise<void> {
  const messages = await loadCatalog(locale);
  i18n.loadAndActivate({ locale, messages });
}

// Static require-map for React Native / Metro.
// Metro cannot dynamic-import; all catalogs are bundled and switched at runtime.
const mobileMessages: Partial<Record<SupportedLocale, unknown>> = {};

export function registerMobileMessages(
  locale: SupportedLocale,
  messages: unknown
): void {
  mobileMessages[locale] = messages;
}

export function activateLocaleMobile(locale: SupportedLocale): void {
  const messages = (mobileMessages[locale] ?? mobileMessages[SOURCE_LOCALE]) as Record<string, string>;
  if (!messages) return;
  i18n.loadAndActivate({ locale, messages });
}
