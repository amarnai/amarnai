import type { Metadata } from "next";
import { SOURCE_LOCALE } from "@amarnai/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { buildHomeMetadata } from "@/lib/seo";
import { LandingContent } from "@/components/landing/LandingContent";
import { SiteProviders } from "./SiteProviders";
import { NonSourceLocaleRedirect } from "./NonSourceLocaleRedirect";

// The bare domain is the site's canonical, most-linked URL, so it serves the
// source-locale (English) homepage content directly rather than bouncing through
// a client-side redirect. That keeps `/` a real 200 content page for crawlers.
export async function generateMetadata(): Promise<Metadata> {
  const i18n = await initServerI18n(SOURCE_LOCALE);
  return buildHomeMetadata(i18n, SOURCE_LOCALE);
}

// This route lives outside the `[locale]` segment, so it can't inherit that
// layout's providers; it wraps the landing content in the same stack itself.
// `NonSourceLocaleRedirect` forwards only non-English visitors to `/{locale}`;
// English visitors and crawlers stay here on the fully rendered page.
export default async function RootPage() {
  const i18n = await initServerI18n(SOURCE_LOCALE);

  return (
    <SiteProviders locale={SOURCE_LOCALE} messages={i18n.messages}>
      <NonSourceLocaleRedirect />
      <LandingContent />
    </SiteProviders>
  );
}
