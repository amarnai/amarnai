"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import "./taxonomy-editor.css";

/**
 * Collapsed writing guidance for folder descriptions. The description is what
 * the classifier actually matches against, so a vague one quietly degrades
 * sorting; this is the cheapest place to explain that.
 */
export function DescriptionTips() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="tx-tips-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg
          className={`tx-tips-caret${open ? " is-open" : ""}`}
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        {open ? <Trans>Hide tips</Trans> : <Trans>How to write a good description</Trans>}
      </button>
      {open && (
        <div className="tx-tips">
          <p>
            <Trans>
              Describe what kinds of emails belong here: who they come from and what they are
              about. Be specific and use the actual names, topics, and words that show up in those
              emails. Describe what the emails are, not what you plan to do about them. The
              clearer your description, the more accurately your email is sorted here.
            </Trans>
          </p>
          <div className="tx-tip-good">
            ✓ <Trans>Receipts, payment confirmations, and billing questions from vendors.</Trans>
          </div>
          <div className="tx-tip-bad">
            ✗ <Trans>Emails about my bills that I need to deal with.</Trans>
          </div>
        </div>
      )}
    </div>
  );
}
