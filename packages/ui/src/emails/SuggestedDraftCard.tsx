"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { formatQuotaResetDate } from "@amarnai/shared";
import type { DraftItem } from "./types.js";
import { Tooltip } from "../Tooltip.js";

export interface SuggestedDraftCardProps {
  draft: DraftItem;
  onToggleSent: () => void;
  onRegenerate?: () => void;
  quota?: { used: number; limit: number; resetsAt: string } | null;
}

export function SuggestedDraftCard({ draft, onToggleSent, onRegenerate, quota }: SuggestedDraftCardProps) {
  const { i18n } = useLingui();
  const [copied, setCopied] = useState(false);
  const isSent = draft.status === "SENT";
  const quotaExhausted = quota != null && quota.used >= quota.limit;
  const quotaResetDate = quota ? formatQuotaResetDate(quota.resetsAt) : null;

  function handleCopy() {
    navigator.clipboard.writeText(draft.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="em-draft-card">
      <div className="em-draft-glyph" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 9.5h8M2 7l5-5 1.5 1.5-5 5H2V7zM7 3l1.5-1.5 1.5 1.5-1.5 1.5L7 3z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div>
        <div className="em-draft-eyebrow"><Trans>Draft reply</Trans></div>
        {draft.subject && <div className="em-draft-title">{draft.subject}</div>}
        <div className="em-draft-body">{draft.body}</div>
        <div className="em-draft-actions">
          <button type="button" className="em-btn" onClick={handleCopy} disabled={copied}>
            {copied ? (
              <>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M1.5 6l2.5 3L10.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <Trans>Copied</Trans>
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="4" y="1" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
                  <rect x="1" y="3" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
                </svg>
                <Trans>Copy</Trans>
              </>
            )}
          </button>
          <button type="button" className="em-btn ghost" onClick={onToggleSent}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M1.5 6l2.5 3L10.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {isSent ? <Trans>Mark as unsent</Trans> : <Trans>Mark as sent</Trans>}
          </button>
          {onRegenerate && (
            <Tooltip content={quotaExhausted ? i18n._(msg`No drafts remaining this month`) : i18n._(msg`Generate a new draft — uses one from your monthly allowance`)}>
              <button
                type="button"
                className="em-btn ghost"
                onClick={onRegenerate}
                disabled={quotaExhausted}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  {/* arc: 3 o'clock → clockwise 270° → 1 o'clock */}
                  <path d="M10,6 A4,4 0 1 1 8,2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  {/* filled arrowhead tangent to arc at 1 o'clock, pointing lower-right */}
                  <polygon points="7.1,4.1 8.9,0.9 10.4,3.9" fill="currentColor" />
                </svg>
                <Trans>Regenerate</Trans>
              </button>
            </Tooltip>
          )}
        </div>
        {quota != null && (
          <p className={`em-draft-quota${quotaExhausted ? " em-draft-quota--exhausted" : ""}`}>
            {quotaExhausted
              ? <Trans>No drafts remaining · resets {quotaResetDate}</Trans>
              : <Trans>{quota.limit - quota.used} of {quota.limit} remaining · resets {quotaResetDate}</Trans>
            }
          </p>
        )}
      </div>
    </div>
  );
}
