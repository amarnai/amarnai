"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 12);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`ld-nav${scrolled ? " scrolled" : ""}`} id="nav">
      <div className="ld-nav-inner">
        <Link className="ld-brand" href="#top" aria-label="Amarnai home">
          <span className="ld-brand-mark" aria-hidden="true" />
          Amarnai
        </Link>

        <nav className="ld-nav-links">
          <Link href="#how">How it works</Link>
          <Link href="#taxonomy">Taxonomy</Link>
          <Link href="#triage">Triage</Link>
          <Link href="#faq">FAQ</Link>
          <Link className="ld-btn ld-nav-cta" href="/pricing">
            See plans
          </Link>
        </nav>
      </div>
    </header>
  );
}
