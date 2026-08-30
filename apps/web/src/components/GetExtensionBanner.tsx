"use client";

import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { CHROME_EXTENSION_STORE_URL } from "@aziru/ui";
import {
  DISMISS_KEY,
  isDesktopExtensionBrowser,
  pickStoreUrl,
} from "./GetExtensionBanner.helpers";

// The published listing is the fallback, so the nudge always has a target; an
// env override exists for self-hosters shipping their own build. Same pair the
// install notification uses (see lib/notifications.ts).
const CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || CHROME_EXTENSION_STORE_URL;
const FIREFOX_STORE_URL = process.env.NEXT_PUBLIC_EXTENSION_STORE_URL_FIREFOX || null;

/**
 * Nudge toward the browser extension, shown to signed-in users who have not
 * registered an install yet (that check is server-side, in the loader).
 *
 * It disappears on its own: the panel calls POST /extension/register the first
 * time it opens, so the loader stops rendering this on the next page load.
 */
export function GetExtensionBanner() {
  const { _ } = useLingui();
  // Null until the effect resolves, so SSR and the first client render agree —
  // both eligibility signals (user agent, localStorage) are client-only.
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktopExtensionBrowser(navigator.userAgent)) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // localStorage can throw (private mode / disabled storage); treat as
      // not-dismissed and still show the banner.
    }
    setHref(pickStoreUrl(navigator.userAgent, CHROME_STORE_URL, FIREFOX_STORE_URL));
  }, []);

  if (!href) return null;

  function dismiss() {
    setHref(null);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignore storage failures; it stays dismissed for this session.
    }
  }

  return (
    <div className="ext-banner" role="region" aria-label={_(msg`Get the Amarnai extension`)}>
      <div className="ext-banner-text">
        <span className="ext-banner-title">
          <Trans>Triage without leaving your inbox</Trans>
        </span>
        <span className="ext-banner-sub">
          <Trans>Amarnai sits in a side panel next to Gmail and Outlook.</Trans>
        </span>
      </div>
      <a className="ext-banner-cta" href={href} target="_blank" rel="noopener noreferrer">
        <Trans>Get the extension</Trans>
      </a>
      <button
        type="button"
        className="ext-banner-close"
        onClick={dismiss}
        aria-label={_(msg`Dismiss`)}
      >
        &times;
      </button>
    </div>
  );
}
