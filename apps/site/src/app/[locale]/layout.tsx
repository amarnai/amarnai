import type { Metadata } from "next";
import {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  SOURCE_LOCALE,
  type SupportedLocale,
} from "@amarnai/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { SiteProviders } from "../SiteProviders";
import { SourceLocaleRedirect } from "../SourceLocaleRedirect";

export const dynamicParams = false;

export function generateStaticParams() {
  // `output: export` requires every `[locale]` param to be generated. The source
  // locale is served at the bare path, so its `/{locale}/*` routes are emitted as
  // thin redirect shells (see the source-locale branch below) rather than being
  // omitted, which would make `/en` a hard export error instead of a redirect.
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

  // Canonical and hreflang alternates are set per-page (see lib/seo.ts); the
  // layout only supplies metadataBase and the shared OpenGraph fields.
  return {
    metadataBase: new URL(BASE_URL),
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

  // The source locale is served at the bare path, so `/{SOURCE_LOCALE}/*` is only
  // a redirect shell that forwards to the bare equivalent (`/en/pricing` ->
  // `/pricing`). It exists solely to satisfy `output: export`'s all-params rule.
  if (validLocale === SOURCE_LOCALE) {
    return <SourceLocaleRedirect />;
  }

  // Activate Lingui for this render's server components, and reuse the loaded
  // catalog for the client provider so both render in the right locale.
  const i18n = await initServerI18n(validLocale);

  return (
    <SiteProviders locale={validLocale} messages={i18n.messages}>
      {children}
    </SiteProviders>
  );
}
