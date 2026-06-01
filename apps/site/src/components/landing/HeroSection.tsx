import Link from "next/link";
import { HeroFeedCard } from "./HeroFeedCard";

export function HeroSection() {
  return (
    <section className="ld-hero" id="hero">
      <div className="ld-wrap">
        <div className="ld-hero-grid">
          <div className="ld-hero-main">
            <div className="ld-hero-badge">
              <span className="ld-tag">Beta · available now</span>
              Hosted · Gmail-first AI triage
            </div>

            <h1>
              Stop sorting email.<br />
              <span className="soft">Sort it once.</span>
            </h1>

            <p className="ld-hero-sub">
              Describe each folder in a sentence and let Amarnai do the rest. It
              sorts new mail as it arrives and works through the thousands of
              threads already in your inbox.
            </p>

            <div className="ld-cta-row">
              <Link className="ld-btn accent lg" href="/pricing">
                Start free
              </Link>
            </div>
            <p className="ld-cta-note">Priced per workspace · 14-day free trial</p>
          </div>

          <div className="ld-hero-side">
            <HeroFeedCard />
          </div>
        </div>

        <div className="ld-trust">
          <span className="ld-trust-label">Built to be trusted</span>
          <div className="ld-trust-items">
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M7.5 1.3 2 3.4v3.7c0 3.2 2.3 5.3 5.5 6.6 3.2-1.3 5.5-3.4 5.5-6.6V3.4L7.5 1.3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              Never auto-sends email
            </span>
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <rect x="3" y="6.5" width="9" height="6.5" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
                <path d="M4.8 6.5V5a2.7 2.7 0 0 1 5.4 0v1.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Tokens encrypted at rest
            </span>
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M2 7.5h11M7.5 2v11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="7.5" cy="7.5" r="5.7" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Open-source &amp; self-hostable
            </span>
            <span className="ld-trust-item">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path d="M7.5 1.5 13 4v3.5c0 .8-.1 1.5-.3 2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M7.5 13.5C4.3 12.2 2 10.2 2 7V4l5.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              Stores minimal email data
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
