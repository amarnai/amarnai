import type { Metadata } from "next";
import { SOURCE_LOCALE } from "@aziru/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { buildPricingMetadata } from "@/lib/seo";
import { PricingContent } from "@/components/pricing/PricingContent";
import { SiteProviders } from "../SiteProviders";
import { NonSourceLocaleRedirect } from "../NonSourceLocaleRedirect";

// The bare `/pricing` URL is the canonical, most-linked pricing page, so it
// serves the source-locale (English) content directly rather than bouncing
// through a client-side redirect, keeping it a real 200 content page for
// crawlers.
export async function generateMetadata(): Promise<Metadata> {
  const i18n = await initServerI18n(SOURCE_LOCALE);
  return buildPricingMetadata(i18n, SOURCE_LOCALE);
}

// Lives outside the `[locale]` segment, so it wraps the content in the shared
// provider stack itself. `NonSourceLocaleRedirect` forwards only non-English
// visitors to `/{locale}/pricing`; English visitors and crawlers stay here.
export default async function PricingPage() {
  const i18n = await initServerI18n(SOURCE_LOCALE);

  return (
    <SiteProviders locale={SOURCE_LOCALE} messages={i18n.messages}>
      <NonSourceLocaleRedirect path="/pricing" />
      <PricingContent />
    </SiteProviders>
  );
}
