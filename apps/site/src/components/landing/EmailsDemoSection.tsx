"use client";

import {
  useEffect,
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
import type { ThreadItem } from "@amarnai/ui/emails";
import { MockEmailsPage } from "@amarnai/ui/emails";
import { MailInboxMock, type MockProvider } from "./MailInboxMock";
import { MailThreadMock } from "./MailThreadMock";
import { getDemoThreads, getDemoFolders, getDemoDraftBodies } from "@/components/demo/demo-seed";

/** Which surface the frame previews: the docked extension or the full web app. */
type Surface = "web" | "ext";

/** Below this rendered frame width the Gmail + workspace split doesn't fit. */
const MIN_SPLIT_FRAME_PX = 720;

/** Divider bounds and defaults, as the Gmail pane's share of the stage. */
const GMAIL_MIN_PCT = 30;
const GMAIL_MAX_PCT = 68;
const GMAIL_DEFAULT_PCT = 52;
const KEY_STEP_PCT = 2;

const clampPct = (pct: number) => Math.min(GMAIL_MAX_PCT, Math.max(GMAIL_MIN_PCT, pct));

/**
 * The addresses the frame can show, in display order. The extension surface
 * covers both mail providers (Gmail and Outlook); the web app is
 * provider-agnostic. Selecting a provider address switches both the surface and
 * which inbox mock sits beside the workspace.
 */
const URL_OPTIONS: { surface: Surface; provider?: MockProvider; host: string }[] = [
  { surface: "ext", provider: "gmail", host: "mail.google.com" },
  { surface: "ext", provider: "outlook", host: "outlook.live.com" },
  { surface: "web", host: "app.amarnai.com" },
];

function LockIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden>
      <rect x="1" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 5V3.8a2 2 0 014 0V5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

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
  const [userMode, setUserMode] = useState<Surface>("ext");
  const [provider, setProvider] = useState<MockProvider>("gmail");
  // The thread whose provider conversation view is open over the stage, if any.
  const [openedThread, setOpenedThread] = useState<ThreadItem | null>(null);
  // null until the frame is first measured (SSR and pre-layout render).
  const [wide, setWide] = useState<boolean | null>(null);
  const mode: Surface = wide === false ? "web" : userMode;

  const threads = useMemo(
    () => getDemoThreads(i18n, provider === "outlook" ? "OUTLOOK" : "GMAIL"),
    [i18n, provider],
  );
  const folders = useMemo(() => getDemoFolders(i18n), [i18n]);
  const draftBodies = useMemo(() => getDemoDraftBodies(i18n), [i18n]);

  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; pct: number } | null>(null);
  const gmailPct = useRef(GMAIL_DEFAULT_PCT);

  const currentHost =
    mode === "web"
      ? "app.amarnai.com"
      : provider === "outlook"
        ? "outlook.live.com"
        : "mail.google.com";

  // The URL pill doubles as a mode picker (same choices as the right-hand
  // toggle). Only interactive when both modes are available; in a narrow frame
  // the split can't fit, so the address is fixed to the web app.
  const urlNavRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!urlNavRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // A frame that narrows past the split threshold hides the toggle; close the
  // URL menu with it so it can't linger over the fixed single-URL pill.
  useEffect(() => {
    if (wide === false) setMenuOpen(false);
  }, [wide]);

  function chooseOption(opt: { surface: Surface; provider?: MockProvider }) {
    setUserMode(opt.surface);
    if (opt.provider) setProvider(opt.provider);
    setMenuOpen(false);
    // The open conversation belongs to the address being left; close it.
    setOpenedThread(null);
  }

  // An address in the dropdown is the current one when its surface matches, and,
  // for the two provider addresses, when its provider matches too.
  const isCurrentOption = (opt: { surface: Surface; provider?: MockProvider }) =>
    opt.surface === "web"
      ? mode === "web"
      : mode === "ext" && opt.provider === provider;

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
            {wide === false ? (
              <div className="ld-url-pill">
                <LockIcon />
                <span>{currentHost}</span>
              </div>
            ) : (
              <div className="ld-url-nav" ref={urlNavRef}>
                <button
                  type="button"
                  className="ld-url-pill ld-url-pill--btn"
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen}
                  aria-label={_(msg`Switch the previewed address`)}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <LockIcon />
                  <span>{currentHost}</span>
                  <svg
                    className="ld-url-caret"
                    width="8"
                    height="5"
                    viewBox="0 0 8 5"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M1 1l3 3 3-3"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {menuOpen && (
                  <ul className="ld-url-menu" role="listbox" aria-label={_(msg`Available addresses`)}>
                    {URL_OPTIONS.map((opt) => {
                      const current = isCurrentOption(opt);
                      return (
                        <li
                          key={opt.host}
                          role="option"
                          aria-selected={current}
                          className={`ld-url-opt${current ? " active" : ""}`}
                          onClick={() => chooseOption(opt)}
                        >
                          <LockIcon />
                          <span className="ld-url-opt-host">{opt.host}</span>
                          <span className="ld-url-opt-label">
                            {opt.surface === "ext" ? <Trans>Browser extension</Trans> : "Web app"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            {wide !== false && (
              <div className="ld-seg" role="group" aria-label={_(msg`Choose how to preview Amarnai`)}>
                <button
                  type="button"
                  aria-pressed={mode === "web"}
                  onClick={() => { setUserMode("web"); setOpenedThread(null); }}
                >
                  Web app
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "ext"}
                  onClick={() => { setUserMode("ext"); setOpenedThread(null); }}
                >
                  <Trans>Browser extension</Trans>
                </button>
              </div>
            )}
          </div>

          <div ref={stageRef} className="ld-demo-stage emails ld-split-stage">
            <div className="ld-gmail-pane">
              <MailInboxMock provider={provider} threads={threads} onOpenThread={setOpenedThread} />
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
            {/* One MockEmailsPage instance per provider: in "ext" mode it renders
                the extension's compact side-panel layout beside the inbox mock;
                in "web" mode the pane widens to the full desktop app. It stays
                mounted across the surface switch so workspace state is shared,
                and `surface` swaps the preview chrome to match the extension
                (Open-in-provider button, star toggle) or the web app. Keying on
                the provider remounts when the inbox switches (Gmail↔Outlook) so
                the threads reload with the matching provider. The rail starts
                closed so the thread list shows first, matching the real side
                panel. */}
            <div className="em-shell ld-app-pane">
              <MockEmailsPage
                key={provider}
                initialThreads={threads}
                initialFolders={folders}
                draftBodies={draftBodies}
                initialRailOpen={false}
                surface={mode === "web" ? "web" : "extension"}
                onOpenInProvider={setOpenedThread}
                syncInfo={{
                  lastSyncedAt: new Date().toISOString(),
                  backfillStatus: "IDLE",
                  workspacePlan: "PRO",
                  pushEnabled: true,
                }}
              />
            </div>

            {openedThread && (
              <MailThreadMock
                provider={provider}
                thread={openedThread}
                onBack={() => setOpenedThread(null)}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
