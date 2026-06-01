"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Tone = "ok" | "review" | "accent" | "neutral";

type PoolItem = {
  from: string;
  init: string;
  hue: number;
  subj: string;
  dest: string;
  tone: Tone;
};

const POOL: PoolItem[] = [
  { from: "Burna-Buriash II",       init: "BB", hue: 220, subj: "Gold balance — third consignment overdue",    dest: "Customers › Enterprise", tone: "ok" },
  { from: "Aziru of Amurru",        init: "AA", hue: 140, subj: "Alliance proposal — house of Amurru",          dest: "Needs review",           tone: "review" },
  { from: "Royal Appointments",     init: "RA", hue: 65,  subj: "Application: Chief of Correspondence",         dest: "Hiring",                 tone: "accent" },
  { from: "Rib-Hadda of Byblos",    init: "RH", hue: 30,  subj: "Re: Grain shipment — third delay this season", dest: "Customers › SMB",        tone: "ok" },
  { from: "Abdi-Heba of Urusalim",  init: "AU", hue: 55,  subj: "Passing through the Delta — free to meet?",   dest: "Needs review",           tone: "review" },
  { from: "Tushratta of Mitanni",   init: "TM", hue: 280, subj: "Council convening — season of Shemu",          dest: "Investors › Current",    tone: "accent" },
  { from: "Horemheb of Thebes",     init: "HT", hue: 190, subj: "Re: Interview — Chief of Correspondence",     dest: "Hiring",                 tone: "accent" },
  { from: "Scribal Office",         init: "SO", hue: 75,  subj: "Q2 clay tablet ledger — please review",        dest: "Other",                  tone: "neutral" },
];

const MAX = 5;

type FeedRow = PoolItem & {
  id: string;
  resolved: boolean;
  leaving: boolean;
  animateIn: boolean;
};

function FolderIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M1 3 2.4 1.6h2.2L5.9 3H11a.8.8 0 0 1 .8.8V9a.8.8 0 0 1-.8.8H1A.8.8 0 0 1 .2 9V3Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RouteChip({ tone, dest, resolved }: { tone: Tone; dest: string; resolved: boolean }) {
  if (!resolved) {
    return (
      <span className="ld-route-chip ld-route-chip--sorting">
        <span className="ld-chip-spin" aria-hidden />
        Sorting…
      </span>
    );
  }
  const toneClass = tone !== "accent" ? ` ld-route-chip--${tone}` : "";
  return (
    <span className={`ld-route-chip ld-route-chip--resolved${toneClass}`}>
      <span className="ld-chip-fi" aria-hidden><FolderIcon /></span>
      {dest}
    </span>
  );
}

function seedRows(): FeedRow[] {
  return Array.from({ length: MAX }, (_, i) => {
    const item = POOL[i % POOL.length]!;
    return { id: `seed-${i}`, ...item, resolved: true, leaving: false, animateIn: false };
  });
}

export function HeroFeedCard() {
  const [rows, setRows] = useState<FeedRow[]>(seedRows);
  const [filed, setFiled] = useState(5);
  const [reviewCount, setReviewCount] = useState(1);
  const cursorRef = useRef(MAX % POOL.length);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rowHeightRef = useRef(0);
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const totalH = body.getBoundingClientRect().height;
    rowHeightRef.current = (totalH - 14) / MAX;
    body.style.height = `${totalH}px`;
    setMeasured(true);
  }, []);

  const tick = useCallback(() => {
    const item = POOL[cursorRef.current % POOL.length]!;
    cursorRef.current++;
    const newId = `row-${Date.now()}`;

    setRows(prev => {
      const next: FeedRow[] = [
        { id: newId, ...item, resolved: false, leaving: false, animateIn: true },
        ...prev,
      ];
      if (next.length > MAX) {
        return next.map((r, i) => i === MAX ? { ...r, leaving: true } : r);
      }
      return next;
    });

    setTimeout(() => {
      setRows(prev => prev.filter(r => !r.leaving));
    }, 460);

    setTimeout(() => {
      setRows(prev => prev.map(r => r.id === newId ? { ...r, resolved: true } : r));
      if (item.tone === "review") setReviewCount(c => c + 1);
      else setFiled(c => c + 1);
    }, 1100);

    timerRef.current = setTimeout(tick, 2800);
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    timerRef.current = setTimeout(tick, 1800);
  }, [tick]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const card = cardRef.current;
    if (!card) return;

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        entries => entries.forEach(e => (e.isIntersecting ? start() : stop())),
        { threshold: 0 },
      );
      io.observe(card);
      return () => { io.disconnect(); stop(); };
    }

    start();
    return stop;
  }, [start, stop]);

  const visibleRows = rows.filter(r => !r.leaving);
  const rowTop = (row: FeedRow): number => {
    if (row.leaving) return 7 + (MAX - 1) * rowHeightRef.current;
    const idx = visibleRows.findIndex(r => r.id === row.id);
    return 7 + idx * rowHeightRef.current;
  };

  return (
    <div className="ld-feed-card" ref={cardRef}>
      <div className="ld-feed-cap">
        <span className="ld-feed-dots" aria-hidden>
          <i /><i /><i />
        </span>
        <span className="ld-feed-url">app.amarnai.com</span>
        <span className="ld-feed-live">
          <span className="ld-feed-live-dot" />
          Sorting live
        </span>
      </div>

      <div className={`ld-feed-body${measured ? " ld-feed-body--measured" : ""}`} ref={bodyRef}>
        {rows.map(row => (
          <div
            key={row.id}
            className={[
              "ld-feed-row",
              row.animateIn && !row.leaving ? "ld-feed-row--enter" : "",
              row.leaving ? "ld-feed-row--leave" : "",
            ].filter(Boolean).join(" ")}
            style={measured ? { top: `${rowTop(row)}px` } : undefined}
            data-sep={measured && !row.leaving && visibleRows.findIndex(r => r.id === row.id) > 0 ? "" : undefined}
          >
            <span
              className="ld-feed-ava"
              style={{ background: `oklch(62% 0.11 ${row.hue})` }}
            >
              {row.init}
            </span>
            <span className="ld-feed-meta">
              <span className="ld-feed-from">{row.from}</span>
              <span className="ld-feed-subj">{row.subj}</span>
            </span>
            <RouteChip
              key={row.resolved ? "r" : "p"}
              tone={row.tone}
              dest={row.dest}
              resolved={row.resolved}
            />
          </div>
        ))}
      </div>

      <div className="ld-feed-foot">
        <span className="ld-feed-foot-l">
          <span className="ld-feed-scan-dot" />
          Triaging · 412 threads
        </span>
        <span className="ld-feed-foot-r">
          {filed} filed · {reviewCount} needs review
        </span>
      </div>
    </div>
  );
}
