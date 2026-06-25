"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { matchLocale } from "@amarnai/i18n";

const STORAGE_KEY = "amarnai_locale";

export function LocaleRedirect() {
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
    router.replace(`/${locale}`);
  }, [router]);

  return null;
}
