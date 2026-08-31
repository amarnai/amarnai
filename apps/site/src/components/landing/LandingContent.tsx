import { Nav } from "./Nav";
import { HeroSection } from "./HeroSection";
import { HowItWorksSection } from "./HowItWorksSection";
import { TaxonomyDemoSection } from "./TaxonomyDemoSection";
import { CollaborationSection } from "./CollaborationSection";
import { EmailsDemoSection } from "./EmailsDemoSection";
import { ReviewsSection } from "./ReviewsSection";
import { FAQSection } from "./FAQSection";
import { FinalCTASection } from "./FinalCTASection";
import { Footer } from "./Footer";
import { RevealObserver } from "./RevealObserver";
import "@/app/landing.css";

// The full marketing landing page, shared by the localized route
// (`/[locale]`) and the source-locale homepage at the bare domain (`/`). The
// caller must activate server-side i18n for the target locale before rendering
// so the `<Trans>` macros in these sections resolve correctly.
export function LandingContent() {
  return (
    <>
      <Nav />
      <main id="top" suppressHydrationWarning>
        <HeroSection />
        <EmailsDemoSection />
        <HowItWorksSection />
        <TaxonomyDemoSection />
        <CollaborationSection />
        <ReviewsSection />
        <FAQSection />
        <FinalCTASection />
      </main>
      <Footer />
      <RevealObserver />
    </>
  );
}
