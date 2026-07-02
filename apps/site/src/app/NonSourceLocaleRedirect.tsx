"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { matchLocale, SOURCE_LOCALE } from "@amarnai/i18n";

const STORAGE_KEY = "amarnai_locale";

// Bare paths (`/`, `/pricing`) serve the source-locale (English) content
// directly, so they are real, crawlable content pages rather than redirect
// shells. This component runs only on the client: if the visitor's stored or
// browser locale resolves to a *non-source* language, it forwards them to the
// localized equivalent (`/{locale}{path}`). English visitors and crawlers stay
// on the bare path with no redirect, keeping the canonical URL a 200 content
// page. `path` is the suffix after the locale segment (default "").
export function NonSourceLocaleRedirect({ path = "" }: { path?: string }) {
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const preferredLocales = stored
      ? [stored]
      : navigator.languages?.length
        ? [...navigator.languages]
        : [navigator.language];
    const locale = matchLocale(preferredLocales);
    if (locale !== SOURCE_LOCALE) {
      router.replace(`/${locale}${path}`);
    }
  }, [router, path]);

  return null;
}
