export const SOURCE_LOCALE = "en" as const;

export const SUPPORTED_LOCALES = [
  "en",
  "fr",
  "es",
  "de",
  "pt-BR",
  "it",
  "nl",
  "ja",
  "zh-CN",
  "tr",
  "id",
  "pl",
  "vi",
  "ru",
  "th",
  "ko",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
  it: "Italiano",
  nl: "Nederlands",
  ja: "日本語",
  "zh-CN": "中文（简体）",
  tr: "Türkçe",
  id: "Bahasa Indonesia",
  pl: "Polski",
  vi: "Tiếng Việt",
  ru: "Русский",
  th: "ไทย",
  ko: "한국어",
};

// English names of each language, for use inside LLM prompts (where the
// instruction text is English). Distinct from LOCALE_DISPLAY_NAMES, which are
// endonyms meant for the language picker UI.
export const LOCALE_ENGLISH_LANGUAGE_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  "pt-BR": "Brazilian Portuguese",
  it: "Italian",
  nl: "Dutch",
  ja: "Japanese",
  "zh-CN": "Simplified Chinese",
  tr: "Turkish",
  id: "Indonesian",
  pl: "Polish",
  vi: "Vietnamese",
  ru: "Russian",
  th: "Thai",
  ko: "Korean",
};

export function isSupportedLocale(locale: unknown): locale is SupportedLocale {
  return (
    typeof locale === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(locale)
  );
}

// Parse an `Accept-Language` header (e.g. "fr-FR,fr;q=0.9,en;q=0.8") into a
// supported locale, ignoring quality weights. Falls back to the source locale.
export function localeFromAcceptLanguage(header: string | null | undefined): SupportedLocale {
  const preferred = (header ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter(Boolean);
  return matchLocale(preferred);
}

export function matchLocale(preferredLocales: string[]): SupportedLocale {
  for (const preferred of preferredLocales) {
    const exact = preferred.toLowerCase();
    if (isSupportedLocale(exact)) return exact;
    // region-insensitive fallback: "pt-br" -> "pt-BR", "zh-cn" -> "zh-CN"
    const matched = SUPPORTED_LOCALES.find(
      (l) => l.toLowerCase() === exact || l.split("-")[0] === exact.split("-")[0]
    );
    if (matched) return matched;
  }
  return SOURCE_LOCALE;
}
