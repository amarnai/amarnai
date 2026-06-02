import type { Metadata } from "next";
import "./landing.css";
import { Nav } from "@/components/landing/Nav";
import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { TaxonomyDemoSection } from "@/components/landing/TaxonomyDemoSection";
import { EmailsDemoSection } from "@/components/landing/EmailsDemoSection";
import { FAQSection } from "@/components/landing/FAQSection";
import { FinalCTASection } from "@/components/landing/FinalCTASection";
import { Footer } from "@/components/landing/Footer";
import { RevealObserver } from "@/components/landing/RevealObserver";

export const metadata: Metadata = {
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
    "gmail automation",
    "email sorting software",
    "ai email management",
    "gmail inbox organizer",
  ],
  metadataBase: new URL("https://amarnai.com"),
  openGraph: {
    title: "Amarnai — AI email triage",
    description:
      "Amarnai sorts your Gmail threads into folders you define, drafts replies for your approval, and explains every decision. Open-source and self-hostable.",
    url: "https://amarnai.com",
    siteName: "Amarnai",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Amarnai" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Amarnai — AI email triage",
    description:
      "Amarnai sorts your Gmail threads into folders you define, drafts replies for your approval, and explains every decision. Open-source and self-hostable.",
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
};

export default function HomePage() {
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
