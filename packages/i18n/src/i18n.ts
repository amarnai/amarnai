import { i18n } from "@lingui/core";
import { type SupportedLocale, SOURCE_LOCALE } from "./locales.js";

export { i18n };

// Web/worker catalog loaders (dynamic, code-split) live in load-catalog.ts and
// are re-exported from the package barrel. Metro resolves load-catalog.native.ts
// instead, since it cannot transform their dynamic import.

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
  // Always activate, even when no catalog is registered (fall back to an empty
  // map). Lingui's I18nProvider renders `null` and provides no context until
  // `i18n.locale` is set, which would unmount the app subtree and make
  // useLingui throw in nested layouts. With empty messages, macro strings fall
  // back to their source English text.
  const messages = (mobileMessages[locale] ??
    mobileMessages[SOURCE_LOCALE] ??
    {}) as Record<string, string>;
  i18n.loadAndActivate({ locale, messages });
}
