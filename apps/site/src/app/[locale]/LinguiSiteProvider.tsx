"use client";

import { useState } from "react";
import { I18nProvider } from "@lingui/react";
import { setupI18n, type Messages } from "@lingui/core";
import { type SupportedLocale } from "@amarnai/i18n";

// Client-side Lingui provider for the marketing site. The compiled catalog is
// loaded on the server and passed in as `messages`, so the instance is activated
// synchronously on the very first render (server and client alike). This keeps
// client components localized in the static HTML rather than flashing English
// until a post-hydration effect runs. A fresh instance is created here rather
// than mutating the shared singleton so concurrent locales never bleed.
export function LinguiSiteProvider({
  locale,
  messages,
  children,
}: {
  locale: SupportedLocale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const [i18n] = useState(() =>
    setupI18n({ locale, messages: { [locale]: messages } })
  );

  // Re-activate on soft navigation between locales, when React reuses this
  // provider instance (so the initializer above does not run again).
  if (i18n.locale !== locale) {
    i18n.loadAndActivate({ locale, messages });
  }

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
