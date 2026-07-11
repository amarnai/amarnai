import Link from "next/link";
import { Trans } from "@lingui/react/macro";

// `anchorBase` mirrors `Nav`: default `""` keeps the section links as in-page
// anchors on the landing route; other routes pass `"/"` so they resolve to
// `/#how` etc. and navigate home before scrolling.
export function Footer({ anchorBase = "" }: { anchorBase?: string }) {
  return (
    <footer className="ld-footer">
      <div className="ld-wrap">
        <div className="ld-footer-inner">
          <div>
            <div className="ld-brand">
              <img src="/logo.png" alt="" aria-hidden="true" className="ld-brand-mark" />
              Amarnai
            </div>
            <p className="ld-footer-tagline">
              <Trans>Sort emails your way.</Trans>
            </p>
          </div>

          <div className="ld-footer-cols">
            <div className="ld-footer-col">
              <h4><Trans>Product</Trans></h4>
              <Link href={`${anchorBase}#how`}><Trans>How it works</Trans></Link>
              <Link href={`${anchorBase}#taxonomy`}><Trans>Your folders</Trans></Link>
              <Link href={`${anchorBase}#triage`}><Trans>See it work</Trans></Link>
              <Link href="/pricing"><Trans>Pricing</Trans></Link>
            </div>
            <div className="ld-footer-col">
              <h4><Trans>Resources</Trans></h4>
              <Link href={`${anchorBase}#faq`}><Trans>FAQ</Trans></Link>
              <a href="https://docs.amarnai.com" target="_blank" rel="noopener noreferrer"><Trans>Documentation</Trans></a>
              <a href="https://github.com/BenAzlay/amarnai" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <Link href="/support"><Trans>Support</Trans></Link>
            </div>
            <div className="ld-footer-col">
              <h4><Trans>Legal</Trans></h4>
              <Link href="/privacy"><Trans>Privacy</Trans></Link>
              <Link href="/terms"><Trans>Terms</Trans></Link>
            </div>
          </div>
        </div>

        <div className="ld-footer-bottom">
          <span><Trans>© 2026 Amarnai. Open source under AGPL-3.0.</Trans></span>
          <span><Trans>Never auto-sends · Encrypted at rest · Minimal data</Trans></span>
        </div>
      </div>
    </footer>
  );
}
