import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import {
  DemoTaxonomyCanvas,
  HeroFeedCard,
  getDemoDraftBodies,
  getDemoFolders,
  getDemoSummaries,
  getDemoSummaryBullets,
  getDemoThreads,
} from "@amarnai/ui/demo";
import { MockEmailsPage } from "@amarnai/ui/emails";

/** How long a slide stays up before the carousel advances on its own. */
const SLIDE_MS = 9000;

/**
 * The sorted-inbox preview: the same workspace the side panel shows, seeded
 * with the demo threads. `surface="extension"` and a closed rail match what the
 * real panel looks like beside Gmail or Outlook.
 */
function EmailsDemo() {
  const { i18n } = useLingui();
  const threads = useMemo(() => getDemoThreads(i18n), [i18n]);
  const folders = useMemo(() => getDemoFolders(i18n), [i18n]);
  const draftBodies = useMemo(() => getDemoDraftBodies(i18n), [i18n]);
  const summaries = useMemo(() => getDemoSummaries(i18n), [i18n]);
  const summaryBullets = useMemo(() => getDemoSummaryBullets(i18n), [i18n]);

  // The frame is capped to side-panel width: the shared emails grid switches to
  // its compact list/preview layout below 640px of container width, which is
  // the layout the real panel runs.
  return (
    <div className="ld-app-frame wc-slide-frame wc-slide-frame--panel">
      <div className="ld-frame-bar">
        <div className="ld-crumbs">
          <span>
            <Trans>Workspace</Trans>
          </span>
          <span className="ld-sep">/</span>
          <span className="ld-here">
            <Trans>Emails</Trans>
          </span>
        </div>
        <div className="ld-play-note">
          <Trans>Browse the folders. It&apos;s fully interactive.</Trans>
        </div>
      </div>
      <div className="wc-slide-stage em-shell">
        <MockEmailsPage
          initialThreads={threads}
          initialFolders={folders}
          draftBodies={draftBodies}
          summaries={summaries}
          summaryBullets={summaryBullets}
          initialRailOpen={false}
          surface="extension"
        />
      </div>
    </div>
  );
}

function PlanDemo() {
  return (
    <div className="ld-app-frame wc-slide-frame">
      <DemoTaxonomyCanvas />
    </div>
  );
}

function SortingDemo() {
  return <HeroFeedCard />;
}

type Slide = {
  id: string;
  Art: ComponentType;
  title: MessageDescriptor;
  body: MessageDescriptor;
};

// The three demos from the landing page, in the same order and with the same
// copy, so the store listing and the first-run tab tell one story.
const SLIDES: Slide[] = [
  {
    id: "sorting",
    Art: SortingDemo,
    title: msg`Stop sorting email`,
    body: msg`Amarnai sorts your inbox for you, filing old and new mail where it belongs. Threads it is unsure about wait for you in review.`,
  },
  {
    id: "plan",
    Art: PlanDemo,
    title: msg`Generate your plan`,
    body: msg`Your plan is a simple folder tree branching out from your inbox. Let Amarnai generate it from your inbox, start from a template, or draw it yourself.`,
  },
  {
    id: "emails",
    Art: EmailsDemo,
    title: msg`Every email goes where it belongs`,
    body: msg`Every thread lands in one of your folders, exactly where you would expect to find it. When a reply is needed, a draft is one click away, ready for your edits and never sent without them.`,
  },
];

/**
 * The left half of the first-run tab: the landing page's three demos, one at a
 * time. Slides advance on their own so the page shows the whole product without
 * asking for a click, and pause while the pointer or keyboard focus is inside
 * them (slides two and three are interactive, and being yanked mid-drag is
 * worse than a carousel that waits). Only the active slide is mounted, so the
 * canvas and the workspace preview are built on demand.
 */
export function WelcomeCarousel() {
  const { _ } = useLingui();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setTimeout(
      () => setIndex((i) => (i + 1) % SLIDES.length),
      SLIDE_MS,
    );
    return () => clearTimeout(id);
  }, [index, paused]);

  const slide = SLIDES[index]!;
  const { Art } = slide;

  return (
    <section
      className="wc-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        className="wc-stage"
        id={`wc-panel-${slide.id}`}
        role="tabpanel"
        aria-labelledby={`wc-tab-${slide.id}`}
      >
        {/* Keyed so switching slides remounts the art: each demo runs its own
            intro animation from the top rather than resuming mid-way. */}
        <Art key={slide.id} />
      </div>

      <div className="wc-slide-copy">
        <h2 className="wc-slide-title">{_(slide.title)}</h2>
        <p className="wc-slide-text">{_(slide.body)}</p>
      </div>

      <div
        className="wc-dots"
        role="tablist"
        aria-label={_(msg`Choose which part of Amarnai to preview`)}
      >
        {SLIDES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`wc-tab-${s.id}`}
            className={`wc-dot${i === index ? " active" : ""}`}
            aria-selected={i === index}
            aria-controls={`wc-panel-${s.id}`}
            aria-label={_(s.title)}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </section>
  );
}
