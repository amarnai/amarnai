"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { MockEmailsPage } from "@amarnai/ui/emails";
import { GmailInboxMock } from "./GmailInboxMock";
import { getDemoThreads, getDemoFolders, getDemoDraftBodies } from "@/components/demo/demo-seed";

type DemoMode = "web" | "ext";

/** Below this rendered frame width the Gmail + workspace split doesn't fit. */
const MIN_SPLIT_FRAME_PX = 720;

/** Divider bounds and defaults, as the Gmail pane's share of the stage. */
const GMAIL_MIN_PCT = 30;
const GMAIL_MAX_PCT = 68;
const GMAIL_DEFAULT_PCT = 52;
const KEY_STEP_PCT = 2;

const clampPct = (pct: number) => Math.min(GMAIL_MAX_PCT, Math.max(GMAIL_MIN_PCT, pct));

/**
 * A single browser-framed demo with two modes: the Amarnai web app full-width
 * ("web") and the same workspace docked beside a static Gmail inbox ("ext").
 * One MockEmailsPage instance stays mounted across modes — the Gmail pane and
 * divider are hidden with CSS — so folder/thread/draft state is shared.
 * The mode gate reacts to the frame's own rendered width (ResizeObserver),
 * not the viewport; a viewport media query in landing.css covers the
 * pre-hydration frame.
 */
export function EmailsDemoSection() {
  const { i18n, _ } = useLingui();
  const threads = useMemo(() => getDemoThreads(i18n), [i18n]);
  const folders = useMemo(() => getDemoFolders(i18n), [i18n]);
  const draftBodies = useMemo(() => getDemoDraftBodies(i18n), [i18n]);

  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; pct: number } | null>(null);
  const gmailPct = useRef(GMAIL_DEFAULT_PCT);

  const [userMode, setUserMode] = useState<DemoMode>("ext");
  // null until the frame is first measured (SSR and pre-layout render).
  const [wide, setWide] = useState<boolean | null>(null);
  const mode: DemoMode = wide === false ? "web" : userMode;

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setWide(frame.clientWidth >= MIN_SPLIT_FRAME_PX);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  // The divider drives the split off-React (CSS var + aria attribute) so the
  // workspace doesn't re-render on every pointer move.
  function applyGmailPct(pct: number) {
    gmailPct.current = pct;
    stageRef.current?.style.setProperty("--ld-gmail-w", `${pct}%`);
    dividerRef.current?.setAttribute("aria-valuenow", String(Math.round(pct)));
  }

  function beginDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, pct: gmailPct.current };
    stageRef.current?.setAttribute("data-resizing", "true");
  }

  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    const stage = stageRef.current;
    if (!start || !stage) return;
    const deltaPct = ((e.clientX - start.x) / stage.clientWidth) * 100;
    applyGmailPct(clampPct(start.pct + deltaPct));
  }

  function endDrag() {
    if (!dragStart.current) return;
    dragStart.current = null;
    stageRef.current?.removeAttribute("data-resizing");
  }

  function nudge(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowLeft" ? -KEY_STEP_PCT : KEY_STEP_PCT;
    applyGmailPct(clampPct(gmailPct.current + delta));
  }

  return (
    <section className="ld-demo-section" id="triage">
      <div className="ld-wrap">
        <div className="ld-demo-head ld-reveal">
          <div className="ld-copy">
            <h2 className="ld-section-h">
              <Trans>Every email goes where it belongs.</Trans>
            </h2>
            <p className="ld-section-lede">
              <Trans>
                Every thread lands in one of your folders, exactly where you
                would expect to find it. When a reply is needed, a draft is one
                click away, ready for your edits and never sent without them.
              </Trans>
            </p>
          </div>
        </div>

        <div
          ref={frameRef}
          className="ld-app-frame ld-browser-frame ld-reveal"
          data-mode={mode}
        >
          <div className="ld-browser-bar">
            <div className="ld-traffic" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="ld-url-pill">
              <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden>
                <rect x="1" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M3 5V3.8a2 2 0 014 0V5" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <span>{mode === "ext" ? "mail.google.com" : "app.amarnai.com"}</span>
            </div>
            {wide !== false && (
              <div className="ld-seg" role="group" aria-label={_(msg`Choose how to preview Amarnai`)}>
                <button
                  type="button"
                  aria-pressed={mode === "web"}
                  onClick={() => setUserMode("web")}
                >
                  Web app
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "ext"}
                  onClick={() => setUserMode("ext")}
                >
                  <Trans>Browser extension</Trans>
                </button>
              </div>
            )}
          </div>

          <div ref={stageRef} className="ld-demo-stage emails ld-split-stage">
            <div className="ld-gmail-pane" aria-hidden="true">
              <GmailInboxMock threads={threads} />
            </div>
            <div
              ref={dividerRef}
              className="ld-split-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label={_(msg`Resize the split between the inbox and Amarnai`)}
              aria-valuemin={GMAIL_MIN_PCT}
              aria-valuemax={GMAIL_MAX_PCT}
              aria-valuenow={GMAIL_DEFAULT_PCT}
              tabIndex={0}
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={nudge}
            >
              {/* A slim grab handle sitting on the panel's edge, like the
                  resize seam of a docked side panel rather than a two-way
                  before/after slider. Quiet at rest, firming up on hover. */}
              <span className="ld-split-grip" aria-hidden="true" />
              <span className="ld-split-hint"><Trans>Drag to resize</Trans></span>
            </div>
            {/* One MockEmailsPage instance, shared across both modes: in "ext"
                mode it renders the extension's compact side-panel layout beside
                Gmail; in "web" mode the pane widens to the full desktop app.
                It stays mounted across the switch so all workspace state is
                shared. The rail starts closed so the thread list shows first,
                matching the real side panel. */}
            <div className="em-shell ld-app-pane">
              <MockEmailsPage
                initialThreads={threads}
                initialFolders={folders}
                draftBodies={draftBodies}
                initialRailOpen={false}
                syncInfo={{
                  lastSyncedAt: new Date().toISOString(),
                  backfillStatus: "IDLE",
                  workspacePlan: "PRO",
                  pushEnabled: true,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
