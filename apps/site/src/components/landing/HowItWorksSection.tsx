"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { GoogleGIcon, OutlookIcon } from "@amarnai/ui";
import { FolderIcon } from "@amarnai/ui/demo";
import { ProviderToggle, type Provider } from "./ProviderToggle";

function StepArt2() {
  const { _ } = useLingui();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    type Pt = [number, number];
    const SEG: Pt[][] = [
      [
        [72, 46],
        [120, 46],
        [150, 21],
        [196, 21],
      ],
      [
        [72, 46],
        [113, 46],
        [155, 46],
        [196, 46],
      ],
      [
        [72, 46],
        [120, 46],
        [150, 71],
        [196, 71],
      ],
    ];
    const ROOT: Pt = [72, 46];

    const dotEl = container.querySelector<SVGCircleElement>(".ld-flow-dot");
    const folders = [".f1", ".f2", ".f3"].map((s) =>
      container.querySelector(s)
    );
    if (!dotEl) return;
    const dot = dotEl;

    const eio = (p: number) =>
      p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const bez = (cp: [Pt, Pt, Pt, Pt], t: number): Pt => {
      const u = 1 - t,
        a = u * u * u,
        b = 3 * u * u * t,
        c = 3 * u * t * t,
        d = t * t * t;
      return [
        a * cp[0][0] + b * cp[1][0] + c * cp[2][0] + d * cp[3][0],
        a * cp[0][1] + b * cp[1][1] + c * cp[2][1] + d * cp[3][1],
      ];
    };
    const moveDot = (p: Pt) => {
      dot.setAttribute("cx", p[0].toFixed(1));
      dot.setAttribute("cy", p[1].toFixed(1));
    };

    let alive = true,
      paused = false,
      raf = 0;
    let tid: ReturnType<typeof setTimeout>;

    const sleep = (ms: number) =>
      new Promise<void>((r) => {
        tid = setTimeout(r, ms);
      });
    const tween = (dur: number, fn: (t: number) => void) =>
      new Promise<void>((res) => {
        const t0 = performance.now();
        const tick = (now: number) => {
          if (!alive) return res();
          const p = Math.min(1, (now - t0) / dur);
          fn(eio(p));
          if (p < 1) raf = requestAnimationFrame(tick);
          else res();
        };
        raf = requestAnimationFrame(tick);
      });
    const light = (el: Element | null) => {
      if (!el) return;
      el.classList.add("lit");
      setTimeout(() => el.classList.remove("lit"), 600);
    };

    async function run() {
      while (alive) {
        for (let i = 0; i < SEG.length && alive; i++) {
          const seg = SEG[i] as [Pt, Pt, Pt, Pt];
          while (paused && alive) await sleep(120);
          moveDot(ROOT);
          dot.style.opacity = "1";
          await sleep(260);
          await tween(820, (t) => moveDot(bez(seg, t)));
          light(folders[i] ?? null);
          await sleep(320);
          dot.style.opacity = "0";
          await sleep(360);
        }
      }
    }
    run();

    let io: IntersectionObserver | undefined;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            paused = !e.isIntersecting;
          }),
        { threshold: 0 }
      );
      io.observe(container);
    }
    const onVis = () => {
      paused = document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(tid);
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="ld-sa ld-sa-flow" ref={ref}>
      <svg
        viewBox="0 0 300 92"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <path className="ld-flow-link" d="M72 46 C 120 46 150 21 196 21" />
        <path className="ld-flow-link" d="M72 46 L 196 46" />
        <path className="ld-flow-link" d="M72 46 C 120 46 150 71 196 71" />
        <g className="ld-flow-pill ld-flow-root">
          <rect x="8" y="34" width="64" height="24" rx="8" />
          <text x="40" y="50">
            {_(msg`Inbox`)}
          </text>
        </g>
        <g className="ld-flow-folder f1">
          <rect x="196" y="10" width="96" height="22" rx="7" />
          <text x="209" y="25">
            {_(msg`Customers`)}
          </text>
        </g>
        <g className="ld-flow-folder f2">
          <rect x="196" y="35" width="96" height="22" rx="7" />
          <text x="209" y="50">
            {_(msg`Investors`)}
          </text>
        </g>
        <g className="ld-flow-folder f3">
          <rect x="196" y="60" width="96" height="22" rx="7" />
          <text x="209" y="75">
            {_(msg`Team`)}
          </text>
        </g>
        <circle className="ld-flow-dot" cx="72" cy="46" r="4.5" />
      </svg>
    </div>
  );
}

function StepArt3() {
  const { _ } = useLingui();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const textEl = container.querySelector<HTMLElement>(".ld-dr-text");
    const cursorEl = container.querySelector<HTMLElement>(".ld-dr-cursor");
    if (!textEl || !cursorEl) return;

    const DRAFT = _(msg`Thanks for the update. Friday works.`);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      textEl.textContent = DRAFT;
      cursorEl.style.opacity = "1";
      return;
    }

    let alive = true;
    let tid: ReturnType<typeof setTimeout>;

    function startTyping() {
      clearTimeout(tid);
      textEl!.textContent = "";
      cursorEl!.style.opacity = "1";
      cursorEl!.classList.remove("ld-dr-cursor--blink");
      let i = 0;
      function next() {
        if (!alive) return;
        if (i < DRAFT.length) {
          textEl!.textContent = DRAFT.slice(0, i + 1);
          i++;
          tid = setTimeout(next, 36);
        } else {
          cursorEl!.classList.add("ld-dr-cursor--blink");
        }
      }
      next();
    }

    function reset() {
      clearTimeout(tid);
      textEl!.textContent = "";
      cursorEl!.style.opacity = "0";
      cursorEl!.classList.remove("ld-dr-cursor--blink");
    }

    let io: IntersectionObserver | undefined;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (es) => {
          if (es[0]?.isIntersecting) startTyping();
          else reset();
        },
        { threshold: 0.5 }
      );
      io.observe(container);
    } else {
      startTyping();
    }

    return () => {
      alive = false;
      clearTimeout(tid);
      io?.disconnect();
    };
  }, [_]);

  return (
    <div className="ld-sa ld-sa-draft" ref={ref}>
      <div className="ld-dr-thread">
        <span className="ld-sa-ava">PN</span>
        <span className="ld-dr-subj"><Trans>Re: Q3 renewal</Trans></span>
        <span className="ld-dr-flag">
          <span className="ld-chip-fi" aria-hidden>
            <FolderIcon />
          </span>
          <Trans>Billing</Trans>
        </span>
      </div>
      <div className="ld-dr-card">
        <div className="ld-dr-card-top">
          <span className="ld-dr-pen">{penIcon}</span>
          <Trans>Draft reply</Trans>
        </div>
        <div className="ld-dr-body">
          <span className="ld-dr-text" />
          <span className="ld-dr-cursor" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

const stepArrow = (
  <svg
    width="32"
    height="10"
    viewBox="0 0 32 10"
    fill="none"
    aria-hidden="true"
  >
    <line
      x1="0"
      y1="5"
      x2="22"
      y2="5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path d="M19 1 L31 5 L19 9 Z" fill="currentColor" />
  </svg>
);

const penIcon = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M9.3 2.4 11.6 4.7 5.3 11l-3 .7.7-3 6.3-6.3Z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
  </svg>
);

function StepArt1({ provider }: { provider: Provider }) {
  const { _ } = useLingui();
  const ProviderIcon = provider === "outlook" ? OutlookIcon : GoogleGIcon;

  return (
    <div className="ld-sa ld-sa-connect">
      <span
        className="ld-sa-gbtn primary"
        role="img"
        aria-label={
          provider === "outlook"
            ? _(msg`Connect Outlook button`)
            : _(msg`Connect Gmail button`)
        }
      >
        <ProviderIcon size={15} className="ld-sa-g" />
        {provider === "outlook" ? (
          <Trans>Connect Outlook</Trans>
        ) : (
          <Trans>Connect Gmail</Trans>
        )}
      </span>
      <div className="ld-sa-hint">
        <Trans>Never sends · OAuth · revoke anytime</Trans>
      </div>
    </div>
  );
}

export function HowItWorksSection() {
  const [provider, setProvider] = useState<Provider>("gmail");

  const steps = [
    {
      id: "connect",
      title: <Trans>Connect inbox</Trans>,
      headerExtra: (
        <ProviderToggle provider={provider} onChange={setProvider} />
      ),
      body: (
        <Trans>
          Add the browser extension, then sign in with Google or Microsoft.
          Amarnai syncs your threads and labels. It never sends or deletes on
          your behalf.
        </Trans>
      ),
      art: <StepArt1 provider={provider} />,
    },
    {
      id: "describe",
      title: <Trans>Describe your folders</Trans>,
      headerExtra: null,
      body: (
        <Trans>
          Lay out folders like <em>Customers</em>, <em>Investors</em>,{" "}
          <em>Hiring</em>. A simple sentence each: that&apos;s the whole setup.
        </Trans>
      ),
      art: <StepArt2 />,
    },
    {
      id: "find",
      title: <Trans>Find and draft</Trans>,
      headerExtra: null,
      body: (
        <Trans>
          Browse emails easily through your folders. Generate draft replies and
          copy them to your inbox.
        </Trans>
      ),
      art: <StepArt3 />,
    },
  ];

  return (
    <section className="ld-section" id="how">
      <div className="ld-wrap">
        <div className="ld-section-head ld-reveal">
          <h2 className="ld-section-h">
            <Trans>Three steps to a sorted inbox.</Trans>
          </h2>
          <p className="ld-section-lede">
            <Trans>
              Connect once, generate your folders once, and let Amarnai handle
              new mail and the thousands of threads already sitting in your
              inbox.
            </Trans>
          </p>
        </div>

        <div className="ld-steps">
          {steps.map((step, i) => (
            <Fragment key={step.id}>
              {i > 0 && (
                <div className="ld-step-connector" aria-hidden="true">
                  {stepArrow}
                </div>
              )}
              <div className="ld-step ld-reveal">
                <div className="ld-step-head">
                  <h3>{step.title}</h3>
                  {step.headerExtra}
                </div>
                <p>{step.body}</p>
                <div className="ld-step-art">{step.art}</div>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
