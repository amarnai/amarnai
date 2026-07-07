"use client";

import { useMemo } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import type { ThreadItem } from "@amarnai/ui/emails";
import { GmailLogoIcon } from "./icons";

/**
 * Static, non-interactive Gmail-style inbox for the extension mode of the
 * landing demo. It renders the same demo threads that the live Amarnai
 * workspace beside it sorts, so the two panes visibly show the same inbox.
 * The parent pane disables pointer events and hides it from assistive tech;
 * everything here is decorative.
 */
export function GmailInboxMock({ threads }: { threads: ThreadItem[] }) {
  const { i18n } = useLingui();
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.locale, { month: "short", day: "numeric" }),
    [i18n.locale],
  );

  return (
    <div className="ld-gmail">
      <div className="ld-gmail-head">
        <span className="ld-gmail-burger">
          <span />
          <span />
          <span />
        </span>
        <span className="ld-gmail-logo">
          <GmailLogoIcon />
          Gmail
        </span>
        <span className="ld-gmail-search">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <circle cx="5.5" cy="5.5" r="3.7" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <Trans>Search mail</Trans>
        </span>
        <span className="ld-gmail-avatar">A</span>
      </div>

      <div className="ld-gmail-tabs">
        <span className="ld-gmail-tab active">
          <Trans>Primary</Trans>
        </span>
        <span className="ld-gmail-tab">
          <Trans>Promotions</Trans>
        </span>
        <span className="ld-gmail-tab">
          <Trans>Social</Trans>
        </span>
      </div>

      <div className="ld-gmail-list">
        {threads.map((t) => (
          <div key={t.id} className={`ld-gmail-row${t.unread ? " unread" : ""}`}>
            <span className="ld-gmail-check" />
            <svg className="ld-gmail-star" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M7 1.6l1.65 3.4 3.75.5-2.75 2.6.68 3.7L7 10l-3.33 1.8.68-3.7L1.6 5.5l3.75-.5L7 1.6z"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
            <span className="ld-gmail-sender">{t.messages[0]?.fromName ?? t.participants}</span>
            <span className="ld-gmail-line">
              <span className="ld-gmail-subject">{t.subject}</span>
              <span className="ld-gmail-snippet"> · {t.snippet}</span>
            </span>
            <span className="ld-gmail-time">{dateFmt.format(t.latestAt)}</span>
          </div>
        ))}

        {/* De-emphasized filler rows standing in for already-read mail below
            the real threads, so the list reads as a full inbox at any pane
            height without inventing more copy. Styled static (no shimmer, no
            fade) and hard-clipped at the pane edge so it reads as a real
            inbox continuing below the fold, not a loading or broken state. */}
        <div className="ld-gmail-more">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="ld-gmail-row ld-gmail-skel">
              <span className="ld-gmail-check" />
              <svg className="ld-gmail-star" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M7 1.6l1.65 3.4 3.75.5-2.75 2.6.68 3.7L7 10l-3.33 1.8.68-3.7L1.6 5.5l3.75-.5L7 1.6z"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="ld-skel-sender" />
              <span className="ld-skel-line" />
              <span className="ld-skel-time" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
