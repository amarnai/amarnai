"use client";

import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";

// Five-star rating, drawn as filled stars. The visible stars are decorative;
// the accessible name carries the rating for screen readers.
function StarRating() {
  const { _ } = useLingui();

  return (
    <div
      className="ld-review-stars"
      role="img"
      aria-label={_(msg`Rated 5 out of 5`)}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <svg
          key={i}
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 1.2l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.2z" />
        </svg>
      ))}
    </div>
  );
}

function ReviewCard({
  portrait,
  name,
  title,
  source,
  children,
}: {
  portrait: string;
  name: ReactNode;
  title: ReactNode;
  source: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="ld-review ld-reveal">
      <div className="ld-review-head">
        <img className="ld-review-ava" src={portrait} alt="" />
        <figcaption className="ld-review-id">
          <span className="ld-review-name">{name}</span>
          <span className="ld-review-title">{title}</span>
          <StarRating />
        </figcaption>
      </div>
      <blockquote className="ld-review-quote">{children}</blockquote>
      <p className="ld-review-source">{source}</p>
    </figure>
  );
}

export function ReviewsSection() {
  return (
    <section className="ld-section" id="reviews">
      <div className="ld-wrap">
        <div className="ld-section-head ld-reveal">
          <h2 className="ld-section-h">
            <Trans>Reviews from early users</Trans>
          </h2>
        </div>

        <div className="ld-reviews">
          <ReviewCard
            portrait="/akhenaten-review.png"
            name={<Trans>Akhenaten</Trans>}
            title={<Trans>Pharaoh of Egypt</Trans>}
            source={<Trans>Translated from hieroglyphics</Trans>}
          >
            <Trans>
              Before Amarnai, my scribes and I sorted letters from sunrise to
              sunset. Now I finally have the bandwidth to help my vassals,
              promote the cult of Aten, and plan the city of Amarna.
            </Trans>
          </ReviewCard>

          <ReviewCard
            portrait="/aziru-review.png"
            name={<Trans>Aziru</Trans>}
            title={<Trans>King of Amurru</Trans>}
            source={<Trans>Translated from cuneiform</Trans>}
          >
            <Trans>
              Letters reached me from Pharaoh in the south and the Hittites in
              the north, and I could answer only one lord at a time. Amarnai
              puts the mail that cannot wait at the top of my pile and drafts
              my reply, ready for my seal. Nothing important
              goes unanswered now.
            </Trans>
          </ReviewCard>
        </div>
      </div>
    </section>
  );
}
