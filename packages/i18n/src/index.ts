export { i18n, activateLocaleMobile, registerMobileMessages } from "./i18n.js";
export { loadCatalog, activateLocale } from "./load-catalog.js";
export { translateSource } from "./translate-source.js";
export {
  SUPPORTED_LOCALES,
  SOURCE_LOCALE,
  LOCALE_DISPLAY_NAMES,
  LOCALE_ENGLISH_LANGUAGE_NAMES,
  isSupportedLocale,
  matchLocale,
  localeFromAcceptLanguage,
  type SupportedLocale,
} from "./locales.js";
export {
  validateTranslations,
  extractPlaceholders,
  buildTranslationSchema,
  type TranslationEntry,
  type ValidationResult,
} from "./validate-translations.js";
