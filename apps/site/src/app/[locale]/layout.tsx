import type { Metadata } from "next";
import { AppDownloadBanner } from "@amarnai/ui";
import {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  SOURCE_LOCALE,
  type SupportedLocale,
} from "@amarnai/i18n";
import { LinguiSiteProvider } from "./LinguiSiteProvider";
import "../landing.css";

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

  return (
    <LinguiSiteProvider locale={validLocale}>
      <AppDownloadBanner playStoreUrl={process.env.NEXT_PUBLIC_PLAY_STORE_URL} />
      {children}
    </LinguiSiteProvider>
  );
}
