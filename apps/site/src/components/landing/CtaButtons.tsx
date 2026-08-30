"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { InstallExtensionButton } from "./InstallExtensionButton";
import { FIREFOX_EXTENSION_URL } from "../../lib/extension";

interface CtaButtonsProps {
  /** Layout class for the row (the hero and the final CTA center differently). */
  rowClassName: string;
  /** Label for the sign-up link, wrapped in a Trans macro by the caller. */
  signUpLabel: ReactNode;
}

/**
 * The landing page's paired calls to action: install the extension first,
 * sign up on the web second.
 *
 * Installing is the primary action because the extension is where Amarnai is
 * used. Two cases leave no extension button on screen, and both promote the
 * sign-up link so a primary action always exists:
 *   - Firefox while the AMO listing is unpublished (handled here, post-mount).
 *   - Narrow viewports, where no browser can install an extension (handled in
 *     CSS at the same breakpoint that hides the button, so mobile needs no JS).
 */
export function CtaButtons({ rowClassName, signUpLabel }: CtaButtonsProps) {
  // SSR renders the Chrome case, which is what every non-Firefox visitor gets;
  // Firefox is corrected on mount, matching InstallExtensionButton's own
  // hydration-safe detection.
  const [signUpIsPrimary, setSignUpIsPrimary] = useState(false);

  useEffect(() => {
    const isFirefox = /Firefox/.test(navigator.userAgent);
    setSignUpIsPrimary(isFirefox && !FIREFOX_EXTENSION_URL);
  }, []);

  return (
    <div className={rowClassName}>
      <InstallExtensionButton variant="primary" />
      <Link
        className={`ld-btn ld-signup-btn lg${signUpIsPrimary ? " accent" : ""}`}
        href="https://app.aziru.email/sign-up"
      >
        {signUpLabel}
      </Link>
    </div>
  );
}
