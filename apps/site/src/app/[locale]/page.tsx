import type { Metadata } from "next";
import { isSupportedLocale, SOURCE_LOCALE, type SupportedLocale } from "@amarnai/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { buildHomeMetadata } from "@/lib/seo";
import { LandingContent } from "@/components/landing/LandingContent";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const validLocale: SupportedLocale = isSupportedLocale(locale)
    ? locale
    : SOURCE_LOCALE;
  const i18n = await initServerI18n(validLocale);
  return buildHomeMetadata(i18n, validLocale);
}

export default async function LocaleHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const validLocale: SupportedLocale = isSupportedLocale(locale)
    ? locale
    : SOURCE_LOCALE;
  await initServerI18n(validLocale);

  return <LandingContent />;
}
