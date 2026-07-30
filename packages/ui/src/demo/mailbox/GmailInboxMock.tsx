"use client";

import { useMemo } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import type { ThreadItem } from "../../emails/types.js";
import { GmailLogoIcon } from "../icons.js";
import { ProviderLabelChip } from "./ProviderLabelChip.js";
import type { AmarnaiDemoData } from "./types.js";

/**
 * Gmail's inbox list. It renders the same demo threads the Amarnai workspace
 * sorts, so the mailbox and the panel beside it visibly show one inbox, and it
 * is where the mirrored folders show up as Gmail labels: one chip per row,
 * carrying the writeback name and the folder's own color.
 *
 * Clicking a real thread row opens the conversation view; the skeleton filler
 * rows below stay decorative. With `amarnai` null the list is a plain Gmail
 * inbox, which is the off side of the landing page's switch.
 *
 * Gmail's Primary/Promotions/Social category tabs are deliberately not drawn.
 * They are a second filing system sitting an inch from ours, which is the most
 * confusing thing that could share this frame, and Amarnai excludes promotions
 * from triage by default anyway (`includePromotions` defaults false), so those
 * categories are not part of what this section is describing. An inbox with the
 * category tabs turned off is an ordinary Gmail configuration, so nothing here
 * is misrepresented by leaving them out.
 */
export function GmailInboxMock({
  threads,
  amarnai,
  onOpenThread,
}: {
  threads: ThreadItem[];
  amarnai: AmarnaiDemoData | null;
  onOpenThread: (thread: ThreadItem) => void;
}) {
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

      <div className="ld-gmail-list">
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ld-gmail-row${t.unread ? " unread" : ""}`}
            onClick={() => onOpenThread(t)}
          >
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
              {/* Gmail draws a thread's labels before the subject, so the
                  mirrored folder is the first thing on the line. */}
              {t.folderId && amarnai?.providerLabels[t.folderId] && (
                <ProviderLabelChip
                  folderId={t.folderId}
                  segments={amarnai.providerLabels[t.folderId]!}
                  provider="gmail"
                />
              )}
              <span className="ld-gmail-subject">{t.subject}</span>
              <span className="ld-gmail-snippet"> · {t.snippet}</span>
            </span>
            <span className="ld-gmail-time">{dateFmt.format(t.latestAt)}</span>
          </button>
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
