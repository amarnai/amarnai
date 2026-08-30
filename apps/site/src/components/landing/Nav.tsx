"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { ThemeToggle } from "@aziru/ui";

function scrollTo(id: string) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };
}

// `anchorBase` lets the shared nav live on pages other than the landing route.
// On the landing page (default `""`) the section links smooth-scroll in place;
// on other routes (e.g. `/support`, passing `"/"`) they become `/#how` links
// that navigate home and let the browser scroll to the section.
export function Nav({ anchorBase = "" }: { anchorBase?: string }) {
  const { _ } = useLingui();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 12);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const onLanding = anchorBase === "";
  const anchorProps = (id: string) =>
    onLanding
      ? { href: `#${id}`, onClick: scrollTo(id) }
      : { href: `${anchorBase}#${id}` };

  return (
    <header className={`ld-nav${scrolled ? " scrolled" : ""}`} id="nav">
      <div className="ld-nav-inner">
        <a className="ld-brand" {...anchorProps("top")} aria-label={_(msg`Aziru home`)}>
          <img src="/logo.png" alt="" aria-hidden="true" className="ld-brand-mark" />
          Aziru
        </a>

        <nav className="ld-nav-links">
          <a {...anchorProps("how")}><Trans>How it works</Trans></a>
          <a {...anchorProps("taxonomy")}><Trans>Your folders</Trans></a>
          <a {...anchorProps("triage")}><Trans>See it work</Trans></a>
          <a {...anchorProps("faq")}><Trans>FAQ</Trans></a>
          <ThemeToggle className="theme-toggle--nav" />
          <Link className="ld-btn ld-nav-cta accent" href="/pricing">
            <Trans>Pricing</Trans>
          </Link>
        </nav>
      </div>
    </header>
  );
}
