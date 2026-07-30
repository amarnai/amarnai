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
import { Switch } from "@amarnai/ui";
import { MockEmailsPage } from "@amarnai/ui/emails";
import {
  MailboxStage,
  type MockProvider,
  getDemoAmarnaiData,
  getDemoThreads,
  getDemoFolders,
  getDemoDraftBodies,
  getDemoSummaries,
  getDemoSummaryBullets,
  getDemoMembers,
  DEMO_WORKSPACE_PLAN,
} from "@amarnai/ui/demo";
import { BrowserChrome, type DemoTab } from "./BrowserChrome";
import { ProviderToggle } from "./ProviderToggle";

/** Below this rendered frame width there is no room to dock a side panel. */
const MIN_SPLIT_FRAME_PX = 720;

/** Side-panel width bounds, in px, matching a real docked panel's range. */
const PANEL_MIN_PX = 300;
const PANEL_MAX_PX = 460;
const PANEL_DEFAULT_PX = 360;
const KEY_STEP_PX = 16;

const clampPanel = (px: number) => Math.min(PANEL_MAX_PX, Math.max(PANEL_MIN_PX, px));

/**
 * The demo opens on the inbox list, not on a thread.
 *
 * The list is what mail.google.com actually looks like when you land on it, and
 * it is the only view that can make the plural claim in this section's heading:
 * a mirrored label on every row, in the folder's own color. A single open thread
 * shows more of Amarnai at once, but it shows one thread being filed, and it
 * reads as a state someone staged rather than a mailbox someone has.
 *
 * Set this to a thread id to open on that thread instead.
 */
const DEFAULT_OPEN_THREAD_ID: string | null = null;

/**
 * The in-your-inbox demo: one browser with two tabs open, the visitor's mailbox
 * with Amarnai injected into it and the Amarnai web app beside it. Which mailbox
 * is a toggle rather than a third tab, so the demo shows one person's inbox
 * instead of implying they keep Gmail and Outlook open on the same mail.
 *
 * The default view is a mailbox with a thread open, because that is where three
 * of the four injected things live at once — the folder label on the thread, the
 * summary card, and the Amarnai Reply entry point. The inbox list, which shows
 * only the labels, is one Back click away.
 *
 * The switch above the frame turns the injected layer off, and it is scoped in
 * its label ("in your inbox") to exactly what it governs: what the extension
 * puts inside Gmail's and Outlook's own UI. Amarnai's own surfaces — the app
 * tab, the toolbar icon, the side panel — are not injections and stay put, which
 * is also how the real per-workspace settings are drawn.
 */
export function EmailsDemoSection() {
  const { i18n, _ } = useLingui();
  const [tab, setTab] = useState<DemoTab>("inbox");
  const [provider, setProvider] = useState<MockProvider>("gmail");
  const [showAmarnai, setShowAmarnai] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  // The thread open in the mailbox tab. Held here rather than inside the mailbox
  // so the side panel's "Open in <provider>" button can drive it, and held as an
  // id rather than an object so it survives a locale or mailbox change.
  //
  // It starts on a thread rather than on the inbox list because the thread view
  // is where the label, the summary card and the Amarnai Reply pill are all on
  // screen at once. The list, which carries only the labels, is one Back away.
  const [openThreadId, setOpenThreadId] = useState<string | null>(DEFAULT_OPEN_THREAD_ID);
  // null until the frame is first measured (SSR and pre-layout render).
  const [wide, setWide] = useState<boolean | null>(null);
  // Both workspace views are mounted on first use and kept mounted after, so
  // switching tabs or reopening the panel does not reset what the visitor did.
  const [appVisited, setAppVisited] = useState(false);
  const [panelUsed, setPanelUsed] = useState(false);

  const canDockPanel = wide !== false;
  const panelVisible = panelOpen && canDockPanel;

  // One provider at a time, so the mailbox, the app tab and the side panel all
  // agree on which mailbox these threads came from and what "Open in …" means.
  const threads = useMemo(
    () => getDemoThreads(i18n, provider === "outlook" ? "OUTLOOK" : "GMAIL"),
    [i18n, provider],
  );
  const folders = useMemo(() => getDemoFolders(i18n), [i18n]);
  const amarnai = useMemo(() => getDemoAmarnaiData(i18n), [i18n]);
  const draftBodies = useMemo(() => getDemoDraftBodies(i18n), [i18n]);
  const summaries = useMemo(() => getDemoSummaries(i18n), [i18n]);
  const summaryBullets = useMemo(() => getDemoSummaryBullets(i18n), [i18n]);
  const members = useMemo(() => getDemoMembers(i18n), [i18n]);

  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; px: number } | null>(null);
  const panelPx = useRef(PANEL_DEFAULT_PX);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setWide(frame.clientWidth >= MIN_SPLIT_FRAME_PX);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  const openThread = openThreadId ? threads.find((t) => t.id === openThreadId) ?? null : null;

  useEffect(() => {
    if (tab === "app") setAppVisited(true);
  }, [tab]);

  // Switching mailbox is switching product, not switching view: the workspace
  // views remount (keyed on provider) so their thread lists and their "Open in
  // …" buttons name the mailbox now on screen.
  function chooseProvider(next: MockProvider) {
    setProvider(next);
    setOpenThreadId(DEFAULT_OPEN_THREAD_ID);
  }

  // Bring the browser to the mailbox tab and open the thread there, instead of
  // following the real provider deep link out of the page.
  function openInMailbox(thread: { id: string }) {
    setTab("inbox");
    setOpenThreadId(thread.id);
  }

  useEffect(() => {
    if (panelVisible) setPanelUsed(true);
  }, [panelVisible]);

  // The divider drives the split off-React (CSS var + aria attribute) so the
  // workspace doesn't re-render on every pointer move.
  function applyPanelPx(px: number) {
    panelPx.current = px;
    stageRef.current?.style.setProperty("--ld-panel-w", `${px}px`);
    dividerRef.current?.setAttribute("aria-valuenow", String(Math.round(px)));
  }

  function beginDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, px: panelPx.current };
    stageRef.current?.setAttribute("data-resizing", "true");
  }

  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (!start) return;
    // The panel is docked right, so dragging left widens it.
    applyPanelPx(clampPanel(start.px - (e.clientX - start.x)));
  }

  function endDrag() {
    if (!dragStart.current) return;
    dragStart.current = null;
    stageRef.current?.removeAttribute("data-resizing");
  }

  function nudge(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowLeft" ? KEY_STEP_PX : -KEY_STEP_PX;
    applyPanelPx(clampPanel(panelPx.current + delta));
  }

  const workspaceProps = {
    initialThreads: threads,
    initialFolders: folders,
    draftBodies,
    summaries,
    summaryBullets,
    members,
    syncInfo: {
      lastSyncedAt: new Date().toISOString(),
      backfillStatus: "IDLE" as const,
      workspacePlan: DEMO_WORKSPACE_PLAN,
      pushEnabled: true,
    },
  };

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
                Your folders become labels in Gmail and categories in Outlook, so
                every thread is filed where you would expect to find it without
                leaving your mailbox. When a reply is needed, a draft is one click
                away, ready for your edits and never sent without them.
              </Trans>
            </p>
          </div>

          <div className="ld-demo-controls">
            {/* Which mailbox, the same control the connect step above uses. */}
            <ProviderToggle provider={provider} onChange={chooseProvider} />

            {/* Scoped in its own label to what it governs: what Amarnai puts
                inside the mailbox. Off is not a broken state — it is the
                mailbox a visitor already has, which is the comparison worth
                making. */}
            <label className="ld-amarnai-toggle">
              <Switch checked={showAmarnai} onChange={setShowAmarnai} />
              <span>
                <Trans>Amarnai in your inbox</Trans>
              </span>
            </label>
          </div>
        </div>

        <div ref={frameRef} className="ld-app-frame ld-browser-frame ld-reveal" data-tab={tab}>
          <BrowserChrome
            tab={tab}
            provider={provider}
            onTabChange={setTab}
            panelOpen={panelVisible}
            onTogglePanel={() => setPanelOpen((open) => !open)}
            showToolbarIcon={canDockPanel}
          />

          <div
            ref={stageRef}
            className="ld-demo-stage emails ld-split-stage"
            id="ld-tabpanel"
            role="tabpanel"
            aria-labelledby={`ld-tab-${tab}`}
            data-panel={panelVisible ? "open" : undefined}
          >
            <div className="ld-page-pane">
              {/* The mailbox tabs. Keyed on the provider so switching mailboxes
                  reloads the window rather than morphing one into the other. */}
              <div className="ld-tabbody" hidden={tab === "app"}>
                <MailboxStage
                  key={provider}
                  provider={provider}
                  threads={threads}
                  folders={folders}
                  amarnai={showAmarnai ? amarnai : null}
                  openThread={openThread}
                  onOpenThread={(thread) => setOpenThreadId(thread.id)}
                  onCloseThread={() => setOpenThreadId(null)}
                />
              </div>

              {/* The Amarnai tab. Mounted on first visit and kept mounted, so
                  coming back to it finds it as it was left. */}
              {appVisited && (
                <div className="ld-tabbody em-shell" hidden={tab !== "app"}>
                  <MockEmailsPage
                    {...workspaceProps}
                    key={provider}
                    surface="web"
                    onOpenInProvider={openInMailbox}
                  />
                </div>
              )}
            </div>

            {panelUsed && (
              <>
                <div
                  ref={dividerRef}
                  className="ld-split-divider"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={_(msg`Resize the Amarnai side panel`)}
                  aria-valuemin={PANEL_MIN_PX}
                  aria-valuemax={PANEL_MAX_PX}
                  aria-valuenow={PANEL_DEFAULT_PX}
                  tabIndex={0}
                  hidden={!panelVisible}
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
                  <span className="ld-split-hint">
                    <Trans>Drag to resize</Trans>
                  </span>
                </div>

                {/* The browser's side panel: one workspace, both mailboxes, and
                    it stays put across tab switches because the real one does. */}
                <div className="em-shell ld-panel-pane" hidden={!panelVisible}>
                  <MockEmailsPage
                    {...workspaceProps}
                    key={provider}
                    initialRailOpen={false}
                    surface="extension"
                    onOpenInProvider={openInMailbox}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
