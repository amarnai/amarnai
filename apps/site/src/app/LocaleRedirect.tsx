"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { matchLocale, SOURCE_LOCALE } from "@aziru/i18n";

const STORAGE_KEY = "amarnai_locale";

// Redirects an unmatched route (via not-found) to the correct localized route,
// detecting the locale from the stored preference or the browser. The source
// locale maps to the bare path (`/`, `/pricing`) rather than `/{locale}`, since
// `/en` is not generated; other locales map to `/{locale}{path}`. `path` is the
// suffix after the locale segment (default "").
export function LocaleRedirect({ path = "" }: { path?: string }) {
  const router = useRouter();

  useEffect(() => {
    // Use stored preference first, then browser language.
    const stored = localStorage.getItem(STORAGE_KEY);
    const preferredLocales = stored
      ? [stored]
      : navigator.languages?.length
        ? [...navigator.languages]
        : [navigator.language];
    const locale = matchLocale(preferredLocales);
    const prefix = locale === SOURCE_LOCALE ? "" : `/${locale}`;
    router.replace(`${prefix}${path}` || "/");
  }, [router, path]);

  return null;
}
