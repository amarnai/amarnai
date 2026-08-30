"use client";

import React, { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { colors, radii, shadows } from "@aziru/tokens";
import {
  DEFAULT_PACKAGE,
  DEFAULT_SCHEME,
  DISMISS_KEY,
  buildIntentUrl,
  shouldShowBanner,
} from "./AppDownloadBanner.helpers.js";

export interface AppDownloadBannerProps {
  /**
   * Play Store listing URL. The banner is config-gated: when this is empty
   * (no published listing yet) nothing renders. Pass
   * `process.env.NEXT_PUBLIC_PLAY_STORE_URL` from the host app layout.
   */
  playStoreUrl?: string | undefined;
  /** Android package id, used to build the open-if-installed intent URL. */
  packageName?: string;
  /** Custom URI scheme registered by the app. */
  appScheme?: string;
}

export function AppDownloadBanner({
  playStoreUrl,
  packageName = DEFAULT_PACKAGE,
  appScheme = DEFAULT_SCHEME,
}: AppDownloadBannerProps) {
  const { i18n } = useLingui();
  // Default hidden so SSR and the first client render agree (no hydration
  // mismatch); eligibility is resolved in the effect below, client-only.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!playStoreUrl) return;
    if (!shouldShowBanner(navigator.userAgent)) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // localStorage can throw (private mode / disabled storage); treat as
      // not-dismissed and still show the banner.
    }
    setVisible(true);
  }, [playStoreUrl]);

  if (!visible || !playStoreUrl) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignore storage failures; the banner stays dismissed for this session.
    }
  };

  const openUrl = buildIntentUrl(playStoreUrl, packageName, appScheme);

  return (
    <div role="region" aria-label={i18n._(msg`Get the Amarnai app`)} style={bannerStyle}>
      <div style={textStyle}>
        <span style={titleStyle}>
          <Trans>Amarnai for Android</Trans>
        </span>
        <span style={subtitleStyle}>
          <Trans>Triage your inbox on the go.</Trans>
        </span>
      </div>
      <a href={openUrl} style={getButtonStyle} rel="noopener">
        <Trans>Get the app</Trans>
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label={i18n._(msg`Dismiss`)}
        style={closeStyle}
      >
        &times;
      </button>
    </div>
  );
}

const bannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  background: colors.surface,
  borderBottom: `1px solid ${colors.line}`,
  boxShadow: shadows.web.shadow1,
  fontFamily: "var(--f-sans)",
};

const textStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: colors.ink,
  lineHeight: 1.2,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: colors.ink3,
  lineHeight: 1.3,
};

const getButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "8px 14px",
  borderRadius: radii.sm,
  background: colors.accent,
  color: colors.surface,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const closeStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  color: colors.ink3,
  fontSize: 22,
  lineHeight: 1,
  cursor: "pointer",
  borderRadius: radii.sm,
};
