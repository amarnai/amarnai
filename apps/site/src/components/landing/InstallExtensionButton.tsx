"use client";

import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { CHROME_EXTENSION_URL, FIREFOX_EXTENSION_URL } from "../../lib/extension";
import { PuzzlePieceIcon } from "./icons";

type Target = "chrome" | "firefox";

/**
 * Detects the browser client-side. Chromium-family browsers (Chrome, Edge,
 * Brave, Arc, Opera) and everything unknown fall back to the Chrome listing;
 * only Firefox gets the AMO treatment.
 */
function detectTarget(): Target {
  if (typeof navigator !== "undefined" && /Firefox/.test(navigator.userAgent)) {
    return "firefox";
  }
  return "chrome";
}

interface InstallExtensionButtonProps {
  variant: "primary" | "secondary";
  className?: string;
}

export function InstallExtensionButton({
  variant,
  className,
}: InstallExtensionButtonProps) {
  // Render a neutral default (Chrome) until mounted to avoid hydration mismatch.
  const [mounted, setMounted] = useState(false);
  const [target, setTarget] = useState<Target>("chrome");

  useEffect(() => {
    setTarget(detectTarget());
    setMounted(true);
  }, []);

  const cls = [
    "ld-btn",
    "ld-ext-btn",
    variant === "primary" ? "accent" : "",
    "lg",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Firefox listing is not yet published: render nothing until an AMO URL is
  // configured, rather than a dead "coming soon" affordance.
  if (mounted && target === "firefox" && !FIREFOX_EXTENSION_URL) {
    return null;
  }

  const isFirefox = mounted && target === "firefox";
  const href = isFirefox ? FIREFOX_EXTENSION_URL! : CHROME_EXTENSION_URL;

  return (
    <a className={cls} href={href} target="_blank" rel="noopener noreferrer">
      <PuzzlePieceIcon />
      {isFirefox ? (
        <Trans>Add to Firefox</Trans>
      ) : (
        <Trans>Add to Chrome</Trans>
      )}
    </a>
  );
}
