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
  title: "Amarnai | email triage that explains itself",
  description:
    "Amarnai reads your inbox the way you would: it sorts threads into folders you define, and drafts replies you approve. Gmail-first, hosted or self-hosted.",
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
