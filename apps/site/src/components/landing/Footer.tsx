import Link from "next/link";

export function Footer() {
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
              Open-source AI email triage. Gmail-first. Hosted or self-hosted. Your call.
            </p>
          </div>

          <div className="ld-footer-cols">
            <div className="ld-footer-col">
              <h4>Product</h4>
              <Link href="#how">How it works</Link>
              <Link href="#taxonomy">Taxonomy</Link>
              <Link href="#triage">Triage</Link>
              <Link href="/pricing">Pricing</Link>
            </div>
            <div className="ld-footer-col">
              <h4>Resources</h4>
              <Link href="#faq">FAQ</Link>
              <a href="https://docs.amarnai.com" target="_blank" rel="noopener noreferrer">Documentation</a>
              <a href="https://github.com/amarnai/amarnai" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </div>
            <div className="ld-footer-col">
              <h4>Legal</h4>
              <a href="#">Privacy</a>
              <a href="#">Security</a>
            </div>
          </div>
        </div>

        <div className="ld-footer-bottom">
          <span>© 2026 Amarnai. Open source under AGPL-3.0.</span>
          <span>Never auto-sends · Encrypted at rest · Minimal data</span>
        </div>
      </div>
    </footer>
  );
}
