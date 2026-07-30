import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { GoogleGIcon, OutlookIcon } from "@amarnai/ui";
import {
  DemoTaxonomyCanvas,
  HeroFeedCard,
  MailboxStage,
  getDemoAmarnaiData,
  getDemoFolders,
  getDemoThreads,
  type MockProvider,
} from "@amarnai/ui/demo";
import type { ThreadItem } from "@amarnai/ui/emails";

/** How long a slide stays up before the carousel advances on its own. */
const SLIDE_MS = 9000;

/**
 * The in-your-inbox preview: Gmail or Outlook with everything the extension
 * just added to it — the mirrored folder labels, the summary card, the Amarnai
 * Reply pill, and the panel in the mailbox's right rail.
 *
 * The landing page frames this in painted browser chrome. This tab does not:
 * it is already open in a real browser, a few inches below a real toolbar with
 * the real Amarnai icon in it, and a second painted browser here would only
 * make a reader wonder which one to click.
 */
function EmailsDemo() {
  const { i18n, _ } = useLingui();
  const [provider, setProvider] = useState<MockProvider>("gmail");
  const [openThread, setOpenThread] = useState<ThreadItem | null>(null);

  const threads = useMemo(
    () => getDemoThreads(i18n, provider === "outlook" ? "OUTLOOK" : "GMAIL"),
    [i18n, provider],
  );
  const folders = useMemo(() => getDemoFolders(i18n), [i18n]);
  const amarnai = useMemo(() => getDemoAmarnaiData(i18n), [i18n]);

  function chooseProvider(next: MockProvider) {
    setProvider(next);
    // The open thread belongs to the mailbox being left.
    setOpenThread(null);
  }

  return (
    <div className="ld-app-frame wc-slide-frame">
      <div className="ld-frame-bar">
        <div className="ld-crumbs">
          <span>
            <Trans>Your mailbox</Trans>
          </span>
          <span className="ld-sep">/</span>
          <span className="ld-here">{provider === "outlook" ? "Outlook" : "Gmail"}</span>
        </div>
        <div className="wc-provider-seg" role="group" aria-label={_(msg`Choose a mailbox`)}>
          <button
            type="button"
            aria-pressed={provider === "gmail"}
            onClick={() => chooseProvider("gmail")}
          >
            <GoogleGIcon size={13} />
            Gmail
          </button>
          <button
            type="button"
            aria-pressed={provider === "outlook"}
            onClick={() => chooseProvider("outlook")}
          >
            <OutlookIcon size={13} />
            Outlook
          </button>
        </div>
      </div>
      <div className="wc-slide-stage em-shell">
        <MailboxStage
          key={provider}
          provider={provider}
          threads={threads}
          folders={folders}
          amarnai={amarnai}
          openThread={openThread}
          onOpenThread={setOpenThread}
          onCloseThread={() => setOpenThread(null)}
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
    title: msg`Generate your folders`,
    body: msg`Your folders are a simple tree branching out from your inbox. Let Amarnai generate them from your inbox, start from a template, or draw them yourself.`,
  },
  {
    id: "emails",
    Art: EmailsDemo,
    title: msg`Sorted, summarized, and drafted, without leaving your inbox`,
    body: msg`Your folders become labels in Gmail and categories in Outlook, so every thread is filed where you would expect to find it. Each one arrives with a summary, and a reply is one click away, ready for your edits and never sent without them. Assign threads to your team and everyone can see who has what.`,
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
  // Auto-advance is for the visitor who is only watching. The moment someone
  // steers it themselves it stops for good: a carousel that pulls a reader off
  // the slide they just chose is worse than one that never moved.
  const [steered, setSteered] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused || steered) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setTimeout(
      () => setIndex((i) => (i + 1) % SLIDES.length),
      SLIDE_MS,
    );
    return () => clearTimeout(id);
  }, [index, paused, steered]);

  function goTo(next: number) {
    setSteered(true);
    setIndex(next);
  }

  // Relative moves update from the previous index rather than the rendered one,
  // so two clicks landing in the same render still advance two slides.
  function step(delta: number) {
    setSteered(true);
    setIndex((i) => (i + delta + SLIDES.length) % SLIDES.length);
  }

  // The dots are a tablist, and the tablist pattern owns the arrow keys: Tab
  // reaches the group, arrows move within it. Focus follows so the roving
  // selection stays visible.
  function onTabKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const delta =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    step(delta);
    const next = (index + delta + SLIDES.length) % SLIDES.length;
    const tabs = tabsRef.current?.querySelectorAll<HTMLButtonElement>(".wc-dot");
    tabs?.[next]?.focus();
  }

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

      <div className="wc-controls">
        <div
          className="wc-dots"
          role="tablist"
          ref={tabsRef}
          aria-label={_(msg`Choose which part of Amarnai to preview`)}
          onKeyDown={onTabKeyDown}
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
              tabIndex={i === index ? 0 : -1}
              onClick={() => goTo(i)}
            />
          ))}
        </div>

        {/* The dots say where you are; these say you can move. Both wrap
            around, so neither is ever a dead control. */}
        <div className="wc-nav">
          <button
            type="button"
            className="wc-nav-btn"
            aria-label={_(msg`Previous preview`)}
            onClick={() => step(-1)}
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            className="wc-nav-btn"
            aria-label={_(msg`Next preview`)}
            onClick={() => step(1)}
          >
            <ChevronIcon direction="right" />
          </button>
        </div>
      </div>
    </section>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={direction === "left" ? "M10 3.5L5.5 8l4.5 4.5" : "M6 3.5L10.5 8 6 12.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
