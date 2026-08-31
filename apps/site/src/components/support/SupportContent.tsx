import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { Nav } from "../landing/Nav";
import { Footer } from "../landing/Footer";
import { RevealObserver } from "../landing/RevealObserver";
import "@/app/landing.css";

// A small forward/utility arrow shown at the end of each help row.
function RowArrow() {
  return (
    <svg
      className="ld-support-row-arrow"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
    >
      <path
        d="M4 2.5 8.5 7 4 11.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The on-brand support page body: the shared marketing chrome (Nav + Footer)
// wrapped around a single card of contact and help links. Rendered by both the
// bare `/support` route and the localized `/{locale}/support` route, so i18n
// must be activated by the caller before this renders (as with the landing
// page). This URL is the "Support" link on the Google Workspace Marketplace
// listing.
export function SupportContent() {
  return (
    <>
      <Nav anchorBase="/" />
      <main id="top">
        <section className="ld-section">
          <div className="ld-wrap">
            <div className="ld-section-head center ld-reveal">
              <h2 className="ld-section-h">
                <Trans>Get help with Aziru</Trans>
              </h2>
              <p className="ld-section-lede">
                <Trans>
                  If something isn&rsquo;t working or you have a question,
                  here&rsquo;s how to reach us.
                </Trans>
              </p>
            </div>

            <div className="ld-faq ld-support-card ld-reveal">
              <a className="ld-support-row" href="mailto:hello@aziru.email">
                <span className="ld-support-row-main">
                  <span className="ld-support-row-label">
                    <Trans>Email us</Trans>
                  </span>
                  <span className="ld-support-row-value">hello@aziru.email</span>
                </span>
                <RowArrow />
              </a>

              <a
                className="ld-support-row"
                href="https://docs.aziru.email"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="ld-support-row-main">
                  <span className="ld-support-row-label">
                    <Trans>Documentation</Trans>
                  </span>
                  <span className="ld-support-row-value">
                    <Trans>Guides and answers to common questions</Trans>
                  </span>
                </span>
                <RowArrow />
              </a>

              <a
                className="ld-support-row"
                href="https://github.com/aziruhq/aziru/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="ld-support-row-main">
                  <span className="ld-support-row-label">
                    <Trans>Report a bug</Trans>
                  </span>
                  <span className="ld-support-row-value">
                    <Trans>Open an issue on GitHub</Trans>
                  </span>
                </span>
                <RowArrow />
              </a>

              <Link className="ld-support-row" href="/delete-account">
                <span className="ld-support-row-main">
                  <span className="ld-support-row-label">
                    <Trans>Manage your account and data</Trans>
                  </span>
                  <span className="ld-support-row-value">
                    <Trans>Disconnect your inbox or delete your account</Trans>
                  </span>
                </span>
                <RowArrow />
              </Link>

              <Link className="ld-support-row" href="/privacy">
                <span className="ld-support-row-main">
                  <span className="ld-support-row-label">
                    <Trans>Privacy and data handling</Trans>
                  </span>
                  <span className="ld-support-row-value">
                    <Trans>How Aziru stores and protects your data</Trans>
                  </span>
                </span>
                <RowArrow />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer anchorBase="/" />
      <RevealObserver />
    </>
  );
}
