"use client";

import type { ReactNode } from "react";
import { AziruMark } from "@aziru/ui";
import type { MockProvider } from "@aziru/ui/demo";
import { BrowserChrome } from "../landing/BrowserChrome";
import "@/app/landing.css";
import "./store-tiles.css";

const noop = () => {};

/**
 * The shared 1280×800 artboard every store tile renders into: brand + headline
 * band up top, the landing page's browser frame below, bleeding off the tile's
 * bottom edge. `children` fills the page pane; `panel`, when given, docks the
 * Aziru side panel beside it. Everything interactive renders inert — tiles are
 * only ever screenshotted.
 */
export function TileFrame({
  headline,
  provider,
  panel,
  className,
  children,
}: {
  headline: ReactNode;
  /**
   * The mailbox shown in the simulated browser. Omit for tiles showing one of
   * Aziru's own surfaces (e.g. the folder editor): the frame then renders
   * without the browser chrome.
   */
  provider?: MockProvider;
  panel?: ReactNode;
  /** Extra class on the artboard root, for per-tile CSS tweaks. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`st-tile${className ? ` ${className}` : ""}`}>
      <header className="st-band">
        <span className="st-brand">
          <AziruMark size={22} />
          Aziru
        </span>
        <h1>{headline}</h1>
      </header>

      <div
        className={`st-stage ld-app-frame${provider ? " ld-browser-frame" : ""}`}
        data-tab="inbox"
      >
        {provider && (
          <BrowserChrome
            tab="inbox"
            provider={provider}
            onTabChange={noop}
            panelOpen={panel != null}
            onTogglePanel={noop}
            showToolbarIcon
          />
        )}

        <div
          className="ld-demo-stage emails ld-split-stage"
          data-panel={panel != null ? "open" : undefined}
        >
          <div className="ld-page-pane">
            <div className="ld-tabbody">{children}</div>
          </div>

          {panel != null && <div className="em-shell ld-panel-pane">{panel}</div>}
        </div>
      </div>
    </div>
  );
}
