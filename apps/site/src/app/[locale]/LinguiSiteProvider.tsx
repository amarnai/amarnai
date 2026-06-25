"use client";

import { useEffect } from "react";
import { I18nProvider } from "@lingui/react";
import { i18n, activateLocale, type SupportedLocale } from "@amarnai/i18n";

export function LinguiSiteProvider({
  locale,
  children,
}: {
  locale: SupportedLocale;
  children: React.ReactNode;
}) {
  useEffect(() => {
    activateLocale(locale).catch(console.error);
  }, [locale]);

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
