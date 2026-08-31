"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { GoogleGIcon, OutlookIcon } from "@aziru/ui";
import {
  AziruCompose,
  DRAFTING_MS,
  FolderIcon,
  type ReplyStage,
} from "@aziru/ui/demo";
import { InstallExtensionButton } from "./InstallExtensionButton";
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
        [72, 66],
        [120, 66],
        [150, 21],
        [196, 21],
      ],
      [
        [72, 66],
        [113, 66],
        [155, 66],
        [196, 66],
      ],
      [
        [72, 66],
        [120, 66],
        [150, 111],
        [196, 111],
      ],
    ];
    const ROOT: Pt = [72, 66];

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
        viewBox="0 0 300 132"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <path className="ld-flow-link" d="M72 66 C 120 66 150 21 196 21" />
        <path className="ld-flow-link" d="M72 66 L 196 66" />
        <path className="ld-flow-link" d="M72 66 C 120 66 150 111 196 111" />
        <g className="ld-flow-pill ld-flow-root">
          <rect x="8" y="54" width="64" height="24" rx="8" />
          <text x="40" y="70">
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
          <rect x="196" y="55" width="96" height="22" rx="7" />
          <text x="209" y="70">
            {_(msg`Investors`)}
          </text>
        </g>
        <g className="ld-flow-folder f3">
          <rect x="196" y="100" width="96" height="22" rx="7" />
          <text x="209" y="115">
            {_(msg`Team`)}
          </text>
        </g>
        <circle className="ld-flow-dot" cx="72" cy="66" r="4.5" />
      </svg>
    </div>
  );
}

function StepArt3({ provider }: { provider: Provider }) {
  const { _ } = useLingui();
  const ref = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<ReplyStage>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const startDraft = useCallback(() => {
    clearTimeout(timer.current);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage("ready");
      return;
    }
    setStage("drafting");
    timer.current = setTimeout(() => setStage("ready"), DRAFTING_MS);
  }, []);

  useEffect(() => {
    const container = ref.current;
    if (!container || !("IntersectionObserver" in window)) {
      startDraft();
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es[0]?.isIntersecting) startDraft();
        else {
          clearTimeout(timer.current);
          setStage("idle");
        }
      },
      { threshold: 0.5 }
    );
    io.observe(container);
    return () => {
      io.disconnect();
      clearTimeout(timer.current);
    };
  }, [startDraft]);

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
      <AziruCompose
        provider={provider}
        toName={_(msg`Priya`)}
        body={_(msg`Thanks for the update. Friday works.`)}
        stage={stage}
        onDraft={startDraft}
        onDiscard={() => {
          clearTimeout(timer.current);
          setStage("idle");
        }}
      />
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

function StepArt1({ provider }: { provider: Provider }) {
  const { _ } = useLingui();
  const ProviderIcon = provider === "outlook" ? OutlookIcon : GoogleGIcon;

  return (
    <div className="ld-sa ld-sa-connect">
      <InstallExtensionButton variant="primary" />
      <svg
        className="ld-sa-connect-arrow"
        width="10"
        height="16"
        viewBox="0 0 10 16"
        fill="none"
        aria-hidden="true"
      >
        <line
          x1="5"
          y1="0"
          x2="5"
          y2="9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path d="M1 8 L5 15 L9 8 Z" fill="currentColor" />
      </svg>
      <span
        className="ld-sa-gbtn"
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
          Aziru syncs your threads and labels. It never sends or deletes on
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
          Browse emails easily through your folders. Click Aziru Reply, and the
          draft lands in your compose window, ready for your edits.
        </Trans>
      ),
      art: <StepArt3 provider={provider} />,
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
              Connect once, generate your folders once, and let Aziru handle
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
