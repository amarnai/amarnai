import type { Messages } from "@lingui/core";
import { AppDownloadBanner, ThemeProvider } from "@aziru/ui";
import { type SupportedLocale } from "@aziru/i18n";
import { LinguiSiteProvider } from "./LinguiSiteProvider";

// Shared provider stack for the marketing site: theme context, the client-side
// Lingui catalog, and the app-download banner. Used by the localized layout
// (`/[locale]/*`) and by the source-locale homepage served at the bare domain
// (`/`), which sits outside the `[locale]` segment and so can't inherit its
// layout. Callers activate server-side i18n and pass the compiled `messages`.
export function SiteProviders({
  locale,
  messages,
  children,
}: {
  locale: SupportedLocale;
  messages: Messages;
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider>
      <LinguiSiteProvider locale={locale} messages={messages}>
        <AppDownloadBanner playStoreUrl={process.env.NEXT_PUBLIC_PLAY_STORE_URL} />
        {children}
      </LinguiSiteProvider>
    </ThemeProvider>
  );
}
