import { useEffect, type ReactNode } from 'react';
import { I18nProvider } from '@lingui/react';
import * as Localization from 'expo-localization';
import {
  i18n,
  registerMobileMessages,
  activateLocaleMobile,
  matchLocale,
  isSupportedLocale,
  type SupportedLocale,
} from '@amarnai/i18n';

// Metro needs static requires for all catalogs (no dynamic import() support).
// Paths are relative from this file to packages/i18n/src/locales/.
// try/catch means missing compiled catalogs don't crash the app — strings
// fall back to their source English text until `pnpm i18n:compile` runs.
function registerAllCatalogs() {
  const localeModules: Array<[SupportedLocale, string]> = [
    ['en', '../../../../packages/i18n/src/locales/en/messages.mjs'],
    ['fr', '../../../../packages/i18n/src/locales/fr/messages.mjs'],
    ['es', '../../../../packages/i18n/src/locales/es/messages.mjs'],
    ['de', '../../../../packages/i18n/src/locales/de/messages.mjs'],
    ['pt-BR', '../../../../packages/i18n/src/locales/pt-BR/messages.mjs'],
    ['it', '../../../../packages/i18n/src/locales/it/messages.mjs'],
    ['nl', '../../../../packages/i18n/src/locales/nl/messages.mjs'],
    ['ja', '../../../../packages/i18n/src/locales/ja/messages.mjs'],
    ['zh-CN', '../../../../packages/i18n/src/locales/zh-CN/messages.mjs'],
  ];

  for (const [locale] of localeModules) {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const mod = (() => {
        switch (locale) {
          case 'en': return require('../../../../packages/i18n/src/locales/en/messages.mjs');
          case 'fr': return require('../../../../packages/i18n/src/locales/fr/messages.mjs');
          case 'es': return require('../../../../packages/i18n/src/locales/es/messages.mjs');
          case 'de': return require('../../../../packages/i18n/src/locales/de/messages.mjs');
          case 'pt-BR': return require('../../../../packages/i18n/src/locales/pt-BR/messages.mjs');
          case 'it': return require('../../../../packages/i18n/src/locales/it/messages.mjs');
          case 'nl': return require('../../../../packages/i18n/src/locales/nl/messages.mjs');
          case 'ja': return require('../../../../packages/i18n/src/locales/ja/messages.mjs');
          case 'zh-CN': return require('../../../../packages/i18n/src/locales/zh-CN/messages.mjs');
          default: return null;
        }
      })();
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (mod) registerMobileMessages(locale, mod);
    } catch {
      // Catalog not compiled yet — strings fall back to English source text.
    }
  }
}

registerAllCatalogs();

export function resolveDeviceLocale(): SupportedLocale {
  const deviceLocales = Localization.getLocales().map((l) => l.languageTag);
  return matchLocale(deviceLocales);
}

export function LinguiProvider({
  locale,
  children,
}: {
  locale: SupportedLocale | null;
  children: ReactNode;
}) {
  const resolvedLocale: SupportedLocale =
    locale && isSupportedLocale(locale) ? locale : resolveDeviceLocale();

  useEffect(() => {
    activateLocaleMobile(resolvedLocale);
  }, [resolvedLocale]);

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
