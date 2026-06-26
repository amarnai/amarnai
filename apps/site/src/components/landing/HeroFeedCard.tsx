"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEMO_THREADS, DEMO_FOLDERS } from "@/components/demo/demo-seed";
import { FolderIcon } from "@/components/landing/icons";

type Tone = "ok" | "review" | "accent" | "neutral";

type PoolItem = {
  from: string;
  init: string;
  hue: number;
  subj: string;
  dest: string;
  tone: Tone;
};

// Hue and initials are presentation-only — everything else comes from demo-seed
const THREAD_DISPLAY: Record<string, { hue: number; init: string }> = {
  t1: { hue: 220, init: "BB" },
  t2: { hue: 140, init: "AA" },
  t3: { hue: 65,  init: "BR" },
  t4: { hue: 30,  init: "RH" },
  t5: { hue: 55,  init: "AU" },
  t6: { hue: 280, init: "TM" },
};

function folderDest(folderId: string | null): string {
  const folder = DEMO_FOLDERS.find(f => f.id === folderId);
  if (!folder) return folderId ?? "";
  if (folder.parentId) {
    const parent = DEMO_FOLDERS.find(f => f.id === folder.parentId);
    if (parent) return `${parent.name} › ${folder.name}`;
  }
  return folder.name;
}

function threadTone(folderId: string | null, status: string | null): Tone {
  if (status === "review") return "review";
  if (folderId?.startsWith("customers")) return "ok";
  if (folderId === "other") return "neutral";
  return "accent";
}

// Only one thread is surfaced as "needs review" so the cycling feed reflects the
// algorithm's true ~1-in-6 review rate rather than the seed's 2-in-6. Other
// review-status threads are shown confidently sorted in the hero.
const HERO_REVIEW_ID = "t2";

const POOL: PoolItem[] = DEMO_THREADS.map(t => {
  const display = THREAD_DISPLAY[t.id] ?? { hue: 200, init: "??" };
  const tone = t.id === HERO_REVIEW_ID
    ? "review"
    : threadTone(t.folderId, t.status === "review" ? "sorted" : t.status);
  return {
    from: t.messages[0]!.fromName,
    init: display.init,
    hue: display.hue,
    subj: t.subject,
    dest: folderDest(t.folderId),
    tone,
  };
});

const MAX = 5;

type FeedRow = PoolItem & {
  id: string;
  resolved: boolean;
  leaving: boolean;
  animateIn: boolean;
};

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
        <a
          className="ld-feed-url"
          href="https://app.amarnai.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          app.amarnai.com
        </a>
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
          Triaging 412 threads
        </span>
        <span className="ld-feed-foot-r">
          {filed} filed, {reviewCount} needs review
        </span>
      </div>
    </div>
  );
}
