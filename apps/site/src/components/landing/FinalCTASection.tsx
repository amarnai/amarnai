import Link from "next/link";

export function FinalCTASection() {
  return (
    <section className="ld-final" id="cta">
      <div className="ld-final-inner ld-reveal">
        <h2>Hand the sorting to Amarnai.</h2>
        <p>
          Connect Gmail and Amarnai starts sorting within minutes. Pricing is
          per workspace. Sort as much mail as you like, with backfill of your
          whole history included.
        </p>
        <Link className="ld-btn accent lg" href="/pricing">
          Try Amarnai
        </Link>
        <div className="ld-final-note">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 1.2 2 3.3v3.4c0 3 2.1 4.9 5 6.1 2.9-1.2 5-3.1 5-6.1V3.3L7 1.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M4.8 7 6.4 8.6 9.4 5.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            Prefer to self-host? It&apos;s open source:
            <br className="ld-final-note-br" />{" "}
            <a href="https://github.com/amarnai/amarnai" target="_blank" rel="noopener noreferrer">
              clone it and run it free
            </a>.
          </span>
        </div>
      </div>
    </section>
  );
}
