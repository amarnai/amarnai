import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { InstallExtensionButton } from "./InstallExtensionButton";

export function FinalCTASection() {
  return (
    <section className="ld-final" id="cta">
      <div className="ld-final-inner ld-reveal">
        <h2><Trans>Hand the sorting to Amarnai.</Trans></h2>
        <p>
          <Trans>
            Connect your inbox and Amarnai starts sorting within minutes. Pricing is
            per workspace. Sorts new mail as it arrives, and works through years
            of backlog.
          </Trans>
        </p>
        <div className="ld-final-cta-row">
          <Link className="ld-btn accent lg" href="https://app.amarnai.com/sign-up">
            <Trans>Try Amarnai</Trans>
          </Link>
          <InstallExtensionButton variant="secondary" />
        </div>
        <p className="ld-final-soon">
          <Trans>Works with Gmail and Outlook.</Trans>
        </p>
        <div className="ld-final-note">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 1.2 2 3.3v3.4c0 3 2.1 4.9 5 6.1 2.9-1.2 5-3.1 5-6.1V3.3L7 1.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M4.8 7 6.4 8.6 9.4 5.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            <Trans>
              Prefer to self-host? It&apos;s open source:
              <br className="ld-final-note-br" />{" "}
              <a href="https://github.com/BenAzlay/amarnai" target="_blank" rel="noopener noreferrer">
                clone it and run it free
              </a>
              .
            </Trans>
          </span>
        </div>
      </div>
    </section>
  );
}
