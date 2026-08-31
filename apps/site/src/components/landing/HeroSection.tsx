import { Trans } from "@lingui/react/macro";
import { ShieldCheckIcon } from "@aziru/ui";
import { HeroFeedCard } from "@aziru/ui/demo";
import { CtaButtons } from "./CtaButtons";

export function HeroSection() {
  return (
    <section className="ld-hero" id="hero">
      <div className="ld-wrap">
        <div className="ld-hero-grid">
          <div className="ld-hero-main">
            <h1>
              <Trans>
                Open your inbox.<br />
                <span className="soft">It&apos;s already sorted.</span>
              </Trans>
            </h1>

            <p className="ld-hero-sub">
              <Trans>
                Save hours of work every week. Aziru sorts your old and new
                emails, summarizes your threads, and drafts your replies.
              </Trans>
            </p>

            <CtaButtons rowClassName="ld-cta-row" signUpLabel={<Trans>Start sorting</Trans>} />

            <p className="ld-hero-cta-note">
              <Trans>Free to start. Ready in minutes.</Trans>
            </p>
          </div>

          <div className="ld-hero-side">
            <HeroFeedCard />
          </div>
        </div>

        <div className="ld-trust">
          <span className="ld-trust-label"><Trans>Privacy by design</Trans></span>
          <div className="ld-trust-items">
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M1.5 7.5Q4.5 3.5 7.5 3.5Q10.5 3.5 13.5 7.5Q10.5 11.5 7.5 11.5Q4.5 11.5 1.5 7.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <circle cx="7.5" cy="7.5" r="1.8" stroke="currentColor" strokeWidth="1.2" />
                <line x1="3" y1="3" x2="12" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <Trans>Never sends or deletes</Trans>
            </span>
            <span className="ld-trust-item">
              <ShieldCheckIcon />
              <Trans>Passed Google&apos;s security review</Trans>
            </span>
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <circle cx="7.5" cy="7.5" r="5.7" stroke="currentColor" strokeWidth="1.2" />
                <path d="M5 7.6 6.8 9.4 10 5.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <Trans>You stay in control</Trans>
            </span>
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <rect x="3" y="6.5" width="9" height="6.5" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
                <path d="M4.8 6.5V5a2.7 2.7 0 0 1 5.4 0v1.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <Trans>No email bodies stored</Trans>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
