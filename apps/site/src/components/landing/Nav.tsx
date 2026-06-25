"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function scrollTo(id: string) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };
}

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
        <a className="ld-brand" href="#top" onClick={scrollTo("top")} aria-label="Amarnai home">
          <img src="/logo.png" alt="" aria-hidden="true" className="ld-brand-mark" />
          Amarnai
        </a>

        <nav className="ld-nav-links">
          <a href="#how" onClick={scrollTo("how")}>How it works</a>
          <a href="#taxonomy" onClick={scrollTo("taxonomy")}>Plan</a>
          <a href="#triage" onClick={scrollTo("triage")}>Triage</a>
          <a href="#faq" onClick={scrollTo("faq")}>FAQ</a>
          <Link className="ld-btn ld-nav-cta accent" href="/pricing">
            Pricing
          </Link>
        </nav>
      </div>
    </header>
  );
}
