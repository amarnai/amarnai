"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";

function scrollTo(id: string) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };
}

export function Nav() {
  const { _ } = useLingui();
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
        <a className="ld-brand" href="#top" onClick={scrollTo("top")} aria-label={_(msg`Amarnai home`)}>
          <img src="/logo.png" alt="" aria-hidden="true" className="ld-brand-mark" />
          Amarnai
        </a>

        <nav className="ld-nav-links">
          <a href="#how" onClick={scrollTo("how")}><Trans>How it works</Trans></a>
          <a href="#taxonomy" onClick={scrollTo("taxonomy")}><Trans>Plan</Trans></a>
          <a href="#triage" onClick={scrollTo("triage")}><Trans>Triage</Trans></a>
          <a href="#faq" onClick={scrollTo("faq")}><Trans>FAQ</Trans></a>
          <Link className="ld-btn ld-nav-cta accent" href="/pricing">
            <Trans>Pricing</Trans>
          </Link>
        </nav>
      </div>
    </header>
  );
}
