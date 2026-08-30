"use client";

import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { GmailLogoIcon, type MockProvider } from "@aziru/ui/demo";
import { OutlookIcon } from "@aziru/ui";
import { PuzzlePieceIcon } from "./icons";

/**
 * The two tabs the demo browser has open: the visitor's mailbox, and the
 * Amarnai web app. Which mailbox is a separate axis (the provider toggle), not
 * a third tab — nobody has both a Gmail and an Outlook inbox open to the same
 * mail, and asking a visitor to read one that way was the confusing part.
 */
export type DemoTab = "inbox" | "app";

export function tabHost(tab: DemoTab, provider: MockProvider): string {
  if (tab === "app") return "app.amarnai.com";
  return provider === "outlook" ? "outlook.live.com" : "mail.google.com";
}

function LockIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden>
      <rect x="1" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 5V3.8a2 2 0 014 0V5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function NavArrow({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d={direction === "back" ? "M8.5 3L4.5 7l4 4" : "M5.5 3l4 4-4 4"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M11.5 7a4.5 4.5 0 11-1.6-3.45M11.5 1.5V4H9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The browser around the demo: a tab strip and a toolbar.
 *
 * Deliberately generic rather than a copy of any one browser's chrome. Amarnai
 * ships to both the Chrome Web Store and AMO, and a painted Chrome would tell
 * half the visitors this is not for them. No vendor logos, no vendor wordmarks.
 *
 * Two controls here are live: the tabs, and the pinned Amarnai icon, which opens
 * the side panel the way clicking the real one does. Everything else (the nav
 * arrows, the reload, the address, the extensions puzzle) is drawn so the frame
 * reads as a browser and is inert and hidden from assistive tech, because a
 * control that looks clickable and does nothing is worse than no control.
 */
export function BrowserChrome({
  tab,
  provider,
  onTabChange,
  panelOpen,
  onTogglePanel,
  showToolbarIcon,
}: {
  tab: DemoTab;
  provider: MockProvider;
  onTabChange: (tab: DemoTab) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** False in a frame too narrow to dock a side panel beside the page. */
  showToolbarIcon: boolean;
}) {
  const { _ } = useLingui();
  const stripRef = useRef<HTMLDivElement>(null);

  // The mailbox tab's name and favicon follow the provider toggle, so flipping
  // it visibly changes the tab and the address, not just the page.
  const tabs: { id: DemoTab; label: string; icon: ReactNode }[] = [
    provider === "outlook"
      ? { id: "inbox", label: "Outlook", icon: <OutlookIcon variant="color" size={14} /> }
      : { id: "inbox", label: "Gmail", icon: <GmailLogoIcon /> },
    { id: "app", label: "Amarnai", icon: <img src="/logo.png" alt="" width={14} height={14} /> },
  ];

  // The tablist pattern owns the arrow keys: Tab reaches the strip, arrows move
  // within it, and focus follows so the roving selection stays visible.
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (tabs.findIndex((t) => t.id === tab) + delta + tabs.length) % tabs.length;
    onTabChange(tabs[next]!.id);
    stripRef.current?.querySelectorAll<HTMLButtonElement>(".ld-tab")[next]?.focus();
  }

  return (
    <div className="ld-chrome">
      <div
        className="ld-tabstrip"
        role="tablist"
        aria-label={_(msg`Open tabs`)}
        ref={stripRef}
        onKeyDown={onKeyDown}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ld-tab-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls="ld-tabpanel"
            className={`ld-tab${t.id === tab ? " active" : ""}`}
            tabIndex={t.id === tab ? 0 : -1}
            onClick={() => onTabChange(t.id)}
          >
            <span className="ld-tab-ico">{t.icon}</span>
            <span className="ld-tab-label">{t.label}</span>
          </button>
        ))}
        <span className="ld-tab-plus" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
      </div>

      <div className="ld-toolbar">
        <span className="ld-tb-nav" aria-hidden>
          <NavArrow direction="back" />
          <NavArrow direction="forward" />
          <ReloadIcon />
        </span>

        <span className="ld-url-pill" aria-hidden>
          <LockIcon />
          <span>{tabHost(tab, provider)}</span>
        </span>

        {showToolbarIcon && (
          <span className="ld-tb-ext">
            {/* Pinned extensions sit to the LEFT of the extensions-menu puzzle,
                as they do in the real toolbar. The image is the extension's own
                shipped icon (apps/extension/public/icons/icon128.png, copied to
                this app's public/), not the site logo: this is the one place the
                browser itself draws the icon, so it should be that icon. */}
            <button
              type="button"
              className="ld-tb-amarnai"
              aria-pressed={panelOpen}
              onClick={onTogglePanel}
              aria-label={_(msg`Open the Amarnai side panel`)}
              title={_(msg`Open the Amarnai side panel`)}
            >
              <img src="/extension-icon.png" alt="" width={18} height={18} />
            </button>
            <span className="ld-tb-puzzle" aria-hidden>
              <PuzzlePieceIcon />
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
