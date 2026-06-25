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
};

export function isSupportedLocale(locale: unknown): locale is SupportedLocale {
  return (
    typeof locale === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(locale)
  );
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
