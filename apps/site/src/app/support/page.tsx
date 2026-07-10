import type { Metadata } from "next";
import { SOURCE_LOCALE } from "@amarnai/i18n";
import { initServerI18n } from "@/lib/i18n-server";
import { buildSupportMetadata } from "@/lib/seo";
import { SupportContent } from "@/components/support/SupportContent";
import { SiteProviders } from "../SiteProviders";
import { NonSourceLocaleRedirect } from "../NonSourceLocaleRedirect";

// The bare `/support` URL is the canonical support page (and the URL registered
// on the Google Workspace Marketplace listing), so it serves the source-locale
// content directly rather than bouncing through a client-side redirect, keeping
// it a real 200 content page for crawlers and Google's app review.
export async function generateMetadata(): Promise<Metadata> {
  const i18n = await initServerI18n(SOURCE_LOCALE);
  return buildSupportMetadata(i18n, SOURCE_LOCALE);
}

// Lives outside the `[locale]` segment, so it wraps the content in the shared
// provider stack itself. `NonSourceLocaleRedirect` forwards only non-English
// visitors to `/{locale}/support`; English visitors and crawlers stay here.
export default async function SupportPage() {
  const i18n = await initServerI18n(SOURCE_LOCALE);

  return (
    <SiteProviders locale={SOURCE_LOCALE} messages={i18n.messages}>
      <NonSourceLocaleRedirect path="/support" />
      <SupportContent />
    </SiteProviders>
  );
}
