"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";

// Branding easter egg: explains where the "Amarnai" / "King Aziru" naming comes
// from. Opened from the Connect Gmail CTA by clicking the mascot or the
// "King Aziru" text. Vertical layout: centered title, image, then the story.
export function AziruIntroDialog({ onClose }: { onClose: () => void }) {
  const { _ } = useLingui();
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === backdropRef.current) onClose();
  }

  return (
    <div ref={backdropRef} className="modal-backdrop" onClick={handleBackdropClick}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="aziru-intro-title"
        className="modal aziru-intro-modal"
      >
        <button
          type="button"
          className="modal-close aziru-intro-close"
          aria-label={_(msg`Close`)}
          onClick={onClose}
        >
          ✕
        </button>

        <h2 id="aziru-intro-title" className="modal-title aziru-intro-title">
          <Trans>Who is king Aziru?</Trans>
        </h2>

        <div className="aziru-intro-image">
          <Image
            src="/aziru-introduction.png"
            alt=""
            width={300}
            height={300}
            priority
          />
        </div>

        <p className="text-muted aziru-intro-text">
          <Trans>
            Amarnai is named after the <em>Amarna Letters</em>: clay cuneiform
            tablets used for diplomatic correspondence with the Egyptian pharaohs
            during the
            Bronze Age. One sender of these letters was Aziru, king of Amurru, a
            resourceful ruler and shrewd diplomat who navigated the rivalry between
            Egypt and the Hittites. Thousands of years later, he has found a new
            calling: helping folks like you bring order to their emails.
          </Trans>
        </p>
      </div>
    </div>
  );
}
