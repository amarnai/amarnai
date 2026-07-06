import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { HeroFeedCard } from "./HeroFeedCard";
import { InstallExtensionButton } from "./InstallExtensionButton";

export function HeroSection() {
  return (
    <section className="ld-hero" id="hero">
      <div className="ld-wrap">
        <div className="ld-hero-grid">
          <div className="ld-hero-main">
            <h1>
              <Trans>
                Stop sorting email.<br />
                <span className="soft">Sort it once.</span>
              </Trans>
            </h1>

            <p className="ld-hero-sub">
              <Trans>
                Save hours of email sorting every week. Let Amarnai sort your
                inbox, filing every email, old and new, where it belongs.
              </Trans>
            </p>

            <div className="ld-cta-row">
              <Link className="ld-btn accent lg" href="https://app.amarnai.com/sign-up">
                <Trans>Start sorting</Trans>
              </Link>
              <InstallExtensionButton variant="secondary" />
            </div>

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
              <Trans>Read-only by design</Trans>
            </span>
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M7.5 1.3 2 3.4v3.7c0 3.2 2.3 5.3 5.5 6.6 3.2-1.3 5.5-3.4 5.5-6.6V3.4L7.5 1.3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M5.4 7.6 6.9 9.1 9.8 5.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
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
