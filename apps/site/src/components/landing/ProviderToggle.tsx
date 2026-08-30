"use client";

import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { GoogleGIcon, OutlookIcon } from "@aziru/ui";

export type Provider = "gmail" | "outlook";

/**
 * Which mail provider the page is showing. Two icon buttons, no labels: the
 * marks are unmistakable and it stays small enough to sit inside a demo's
 * chrome. Shared by the connect step and the in-your-inbox demo, so a visitor
 * meets one control for this choice rather than one per section.
 */
export function ProviderToggle({
  provider,
  onChange,
}: {
  provider: Provider;
  onChange: (p: Provider) => void;
}) {
  const { _ } = useLingui();

  return (
    <div className="ld-sa-toggle" role="group" aria-label={_(msg`Choose email provider`)}>
      <button
        type="button"
        className={`ld-sa-toggle-btn${provider === "gmail" ? " active" : ""}`}
        aria-pressed={provider === "gmail"}
        aria-label={_(msg`Show Gmail`)}
        onClick={() => onChange("gmail")}
      >
        <GoogleGIcon size={13} />
      </button>
      <button
        type="button"
        className={`ld-sa-toggle-btn${provider === "outlook" ? " active" : ""}`}
        aria-pressed={provider === "outlook"}
        aria-label={_(msg`Show Outlook`)}
        onClick={() => onChange("outlook")}
      >
        <OutlookIcon size={13} />
      </button>
    </div>
  );
}
