"use client";

import { useRef, type ReactNode } from "react";
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
    <figure className="ld-review">
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
  const { _ } = useLingui();
  const trackRef = useRef<HTMLDivElement>(null);

  // One "page" is whatever is currently in view: two cards on desktop, one on
  // mobile. Scroll snapping lands the track on a card edge.
  const page = (dir: 1 | -1) => {
    const track = trackRef.current;
    track?.scrollBy({ left: dir * track.clientWidth, behavior: "smooth" });
  };

  return (
    <section className="ld-section" id="reviews">
      <div className="ld-wrap">
        <div className="ld-section-head ld-reviews-head ld-reveal">
          <h2 className="ld-section-h">
            <Trans>Reviews from early users</Trans>
          </h2>
          <div className="ld-reviews-nav">
            <button
              type="button"
              className="ld-btn ld-reviews-arrow"
              aria-label={_(msg`Previous reviews`)}
              aria-controls="reviews-track"
              onClick={() => page(-1)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className="ld-btn ld-reviews-arrow"
              aria-label={_(msg`More reviews`)}
              aria-controls="reviews-track"
              onClick={() => page(1)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="ld-reviews ld-reveal" id="reviews-track" ref={trackRef} tabIndex={0}>
          <ReviewCard
            portrait="/akhenaten-review.png"
            name={<Trans>Akhenaten</Trans>}
            title={<Trans>Pharaoh of Egypt</Trans>}
            source={<Trans>Translated from hieroglyphics</Trans>}
          >
            <Trans>
              Before Aziru, my scribes and I sorted letters from sunrise to
              sunset. Now I finally have the bandwidth to help my vassals,
              promote the cult of Aten, and plan the city of Amarna.
            </Trans>
          </ReviewCard>

          <ReviewCard
            portrait="/burna-buriash-review.png"
            name={<Trans>Burna-Buriash</Trans>}
            title={<Trans>King of Babylon</Trans>}
            source={<Trans>Translated from cuneiform</Trans>}
          >
            <Trans>
              Tablets arrive from Egypt, from Hatti, and from every merchant
              robbed on the road to Canaan, and all of them land in the same
              basket. Aziru sorts them before I break the seal: gold shipments
              here, caravan complaints there, marriage terms in their own
              folder. I still write to Pharaoh about the gold, but now it is
              the first letter of my day instead of the last.
            </Trans>
          </ReviewCard>

          <ReviewCard
            portrait="/tushratta-review.png"
            name={<Trans>Tushratta</Trans>}
            title={<Trans>King of Mitanni</Trans>}
            source={<Trans>Translated from cuneiform</Trans>}
          >
            <Trans>
              My letters to Egypt are long, and the replies are longer, and for
              years I could not tell a dowry inventory from a note about the
              statue of Shaushka. Aziru keeps the gold I am owed in one folder
              and the pleasantries in another. Pharaoh still sends less gold
              than promised, but at least I now know exactly which tablet says
              so.
            </Trans>
          </ReviewCard>

          <ReviewCard
            portrait="/abdi-heba-review.png"
            name={<Trans>Abdi-Heba</Trans>}
            title={<Trans>Mayor of Jerusalem</Trans>}
            source={<Trans>Translated from cuneiform</Trans>}
          >
            <Trans>
              I have asked the king for archers in nearly every letter I have
              ever written, and the reports of raids kept getting buried under
              tax accounts. Aziru puts anything urgent from the hill country in
              front of me first. The archers have still not arrived, but my
              inbox is finally in order.
            </Trans>
          </ReviewCard>

          <ReviewCard
            portrait="/rib-hadda-review.png"
            name={<Trans>Rib-Hadda</Trans>}
            title={<Trans>Mayor of Byblos</Trans>}
            source={<Trans>Translated from cuneiform</Trans>}
          >
            <Trans>
              I have sent sixty-eight letters to Pharaoh and received almost
              nothing back, so I know something about a hopeless inbox. Aziru
              files my pleas, my grain shortages, and my warnings about the
              sons of Abdi-Ashirta into their own folders. I remain besieged,
              but I am besieged in an organized way.
            </Trans>
          </ReviewCard>
        </div>
      </div>
    </section>
  );
}
