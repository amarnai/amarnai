import type { Metadata } from "next";
import { AppDownloadBanner, ThemeProvider } from "@amarnai/ui";
import {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  SOURCE_LOCALE,
  type SupportedLocale,
} from "@amarnai/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { LinguiSiteProvider } from "./LinguiSiteProvider";
import "../landing.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

const BASE_URL = "https://amarnai.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const validLocale: SupportedLocale = isSupportedLocale(locale)
    ? locale
    : SOURCE_LOCALE;

  const alternates = Object.fromEntries(
    SUPPORTED_LOCALES.map((l) => [l, `${BASE_URL}/${l}`])
  );

  return {
    metadataBase: new URL(BASE_URL),
    alternates: {
      canonical: `${BASE_URL}/${validLocale}`,
      languages: alternates,
    },
    openGraph: {
      type: "website",
      siteName: "Amarnai",
      locale: validLocale,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const validLocale: SupportedLocale = isSupportedLocale(locale)
    ? locale
    : SOURCE_LOCALE;

  // Activate Lingui for this render's server components, and reuse the loaded
  // catalog for the client provider so both render in the right locale.
  const i18n = await initServerI18n(validLocale);

  return (
    <ThemeProvider>
      <LinguiSiteProvider locale={validLocale} messages={i18n.messages}>
        <AppDownloadBanner playStoreUrl={process.env.NEXT_PUBLIC_PLAY_STORE_URL} />
        {children}
      </LinguiSiteProvider>
    </ThemeProvider>
  );
}
