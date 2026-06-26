"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { matchLocale } from "@amarnai/i18n";

const STORAGE_KEY = "amarnai_locale";

// Redirects a non-localized route (e.g. `/` or `/pricing`) to its localized
// equivalent (`/{locale}` or `/{locale}/pricing`), detecting the locale from the
// stored preference or the browser. `path` is the suffix after the locale segment
// (default ""), letting other non-locale entry points reuse this component
// instead of maintaining a second, unlocalized copy of the page.
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
    router.replace(`/${locale}${path}`);
  }, [router, path]);

  return null;
}
