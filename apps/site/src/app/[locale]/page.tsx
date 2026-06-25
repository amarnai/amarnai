import type { Metadata } from "next";
import { isSupportedLocale, SOURCE_LOCALE, type SupportedLocale } from "@amarnai/i18n";
import { Nav } from "@/components/landing/Nav";
import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { TaxonomyDemoSection } from "@/components/landing/TaxonomyDemoSection";
import { EmailsDemoSection } from "@/components/landing/EmailsDemoSection";
import { FAQSection } from "@/components/landing/FAQSection";
import { FinalCTASection } from "@/components/landing/FinalCTASection";
import { Footer } from "@/components/landing/Footer";
import { RevealObserver } from "@/components/landing/RevealObserver";

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
  const isDefault = validLocale === SOURCE_LOCALE;

  return {
    title: "Amarnai — AI email triage",
    description:
      "Open-source AI email triage for Gmail. Sort threads into folders you define, draft replies with AI, and reach inbox zero — hosted or self-hosted.",
    keywords: [
      "ai email triage",
      "gmail ai assistant",
      "email organizer",
      "inbox zero",
      "open source email ai",
      "self-hosted email assistant",
    ],
    alternates: {
      canonical: isDefault ? BASE_URL : `${BASE_URL}/${validLocale}`,
    },
    openGraph: {
      title: "Amarnai — AI email triage",
      description:
        "Amarnai sorts your Gmail threads into folders you define, drafts replies for your approval, and explains every decision. Open-source and self-hostable.",
      url: isDefault ? BASE_URL : `${BASE_URL}/${validLocale}`,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Amarnai" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Amarnai — AI email triage",
      images: ["/og-image.png"],
    },
    robots: { index: true, follow: true },
  };
}

export default function LocaleHomePage() {
  return (
    <>
      <Nav />
      <main id="top" suppressHydrationWarning>
        <HeroSection />
        <HowItWorksSection />
        <TaxonomyDemoSection />
        <EmailsDemoSection />
        <FAQSection />
        <FinalCTASection />
      </main>
      <Footer />
      <RevealObserver />
    </>
  );
}
