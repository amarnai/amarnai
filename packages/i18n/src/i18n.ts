import { i18n } from "@lingui/core";
import { type SupportedLocale, SOURCE_LOCALE } from "./locales.js";

export { i18n };

// Dynamic catalog loader for web (code-split per locale).
// Mobile uses loadCatalogMobile() instead (static require-map).
export async function activateLocale(locale: SupportedLocale): Promise<void> {
  const { messages } = await import(
    /* webpackMode: "lazy" */
    `./locales/${locale}/messages.mjs`
  );
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
