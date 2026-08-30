import type { Metadata } from "next";
import { isSupportedLocale, SOURCE_LOCALE, type SupportedLocale } from "@aziru/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { buildPricingMetadata } from "@/lib/seo";
import { PricingContent } from "@/components/pricing/PricingContent";

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
  return buildPricingMetadata(i18n, validLocale);
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const validLocale: SupportedLocale = isSupportedLocale(locale)
    ? locale
    : SOURCE_LOCALE;
  await initServerI18n(validLocale);
  return <PricingContent />;
}
