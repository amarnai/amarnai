"use client";

import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import "./upgrade.css";

export type UpgradeSuccessProps = {
  /**
   * The Aziru artwork. Passed in because each surface serves its own static
   * assets: the web app from /public, the extension from its bundled files.
   */
  mascotSrc: string;
  /** Marketing plan name, already localized by the caller. */
  planLabel: string;
  workspaceName: string;
  /**
   * The plan was bought for a workspace other than the one the user is in, so
   * the copy has to say where it landed rather than implying "here".
   */
  isOtherWorkspace?: boolean;
  /** Buttons under the card. */
  children?: ReactNode;
};

/**
 * The moment after a plan is paid for. Mirrors the web app's success page, down
 * to the mascot overlapping the card, so an upgrade looks the same wherever it
 * was bought: this is the one screen a paying user sees, and it should not feel
 * like a lesser version of itself for having happened in a side panel.
 */
export function UpgradeSuccess({
  mascotSrc,
  planLabel,
  workspaceName,
  isOtherWorkspace = false,
  children,
}: UpgradeSuccessProps) {
  return (
    <div className="ug-success">
      <div className="ug-success-mascot">
        <img src={mascotSrc} alt="" width={1254} height={1254} />
      </div>
      <div className="ug-success-card">
        <div className="ug-success-badge">
          <svg width="14" height="14" viewBox="0 0 32 32" fill="none" aria-hidden>
            <circle cx="16" cy="16" r="16" fill="var(--accent)" />
            <path
              d="M9 16.5 13.5 21 23 11"
              stroke="#fff"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Trans>Payment confirmed</Trans>
        </div>

        <h2 className="ug-success-title">
          {isOtherWorkspace ? (
            <Trans>{workspaceName} is on {planLabel}</Trans>
          ) : (
            <Trans>You&apos;re on {planLabel}</Trans>
          )}
        </h2>

        {!isOtherWorkspace && <p className="ug-success-workspace">{workspaceName}</p>}

        <p className="ug-success-body">
          {isOtherWorkspace ? (
            <Trans>Switch to it whenever you are ready. This workspace is unchanged.</Trans>
          ) : (
            <Trans>The new limits apply right away.</Trans>
          )}
        </p>

        {children}
      </div>
    </div>
  );
}
