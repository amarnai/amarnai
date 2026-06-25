export { i18n, loadCatalog, activateLocale, activateLocaleMobile, registerMobileMessages } from "./i18n.js";
export {
  SUPPORTED_LOCALES,
  SOURCE_LOCALE,
  LOCALE_DISPLAY_NAMES,
  isSupportedLocale,
  matchLocale,
  type SupportedLocale,
} from "./locales.js";
export {
  validateTranslations,
  extractPlaceholders,
  buildTranslationSchema,
  type TranslationEntry,
  type ValidationResult,
} from "./validate-translations.js";
