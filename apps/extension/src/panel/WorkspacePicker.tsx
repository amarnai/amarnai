import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { NavGlyph, Switch, ThemeToggle } from "@amarnai/ui";
import { userInitials } from "@amarnai/core";
import { useSession } from "../auth/session";
import { WEB_APP_URL } from "../config";
import { NotificationBell } from "./NotificationBell";
import { isInjectionEnabled, setInjectionEnabled } from "../content/core/settings";

// Slim panel header: workspace switcher, links out to the web app (plan and
// workspace settings), and the user menu (account settings, sign out). At
// 320px there is no room for a full switcher UI, so a native <select> is used
// when the user belongs to more than one workspace. Plan, settings, and
// account pages are not replicated in the panel; the header links to the web
// app, which opens in a new tab under its own cookie session.
export function PanelHeader() {
  const { _ } = useLingui();
  const { user, workspaces, workspaceId, switchWorkspace, signOut } = useSession();
  const active = workspaces.find((w) => w.id === workspaceId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Whether the content scripts inject summaries into Gmail/Outlook themselves.
  // Read lazily when the menu opens: it lives in extension storage, not the session.
  const [injectSummaries, setInjectSummaries] = useState(true);

  useEffect(() => {
    if (!menuOpen) return;
    void isInjectionEnabled().then(setInjectSummaries);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const planLabel = _(
    msg({
      message: "Plan",
      comment:
        "Sidebar nav label for the email-sorting taxonomy. Not a billing or subscription plan.",
    }),
  );
  const settingsLabel = _(msg`Workspace settings`);
  // Short visible label at wide panel widths; the tooltip/aria-label keeps the
  // unambiguous "Workspace settings".
  const settingsShortLabel = _(msg`Settings`);

  return (
    <header className="ax-header">
      {workspaces.length > 1 ? (
        <select
          className="ax-ws-select"
          value={workspaceId ?? ""}
          onChange={(e) => switchWorkspace(e.target.value)}
          aria-label={_(msg`Workspace`)}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="ax-ws-name">{active?.name ?? "Amarnai"}</span>
      )}

      <NotificationBell />

      <a
        className="ax-header-iconbtn"
        href={`${WEB_APP_URL}/plan`}
        target="_blank"
        rel="noopener noreferrer"
        title={planLabel}
        aria-label={planLabel}
      >
        <NavGlyph name="taxonomy" />
        <span className="ax-iconbtn-label">{planLabel}</span>
      </a>
      <a
        className="ax-header-iconbtn"
        href={`${WEB_APP_URL}/settings`}
        target="_blank"
        rel="noopener noreferrer"
        title={settingsLabel}
        aria-label={settingsLabel}
      >
        <NavGlyph name="settings" />
        <span className="ax-iconbtn-label">{settingsShortLabel}</span>
      </a>

      <ThemeToggle className="theme-toggle--panel" />

      <div className="ax-user-menu" ref={menuRef}>
        <button
          type="button"
          className="ax-avatar"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={_(msg`Account menu`)}
        >
          {user ? userInitials(user.name, user.email) : "?"}
        </button>
        {menuOpen && (
          <div className="ax-menu" role="menu">
            {/* Turns the in-Gmail/in-Outlook summary card off without
                uninstalling. Takes effect immediately in every open mail tab
                (the content scripts watch this key). */}
            <label className="ax-menu-item ax-menu-toggle">
              <span><Trans>Summaries in Gmail and Outlook</Trans></span>
              <Switch
                checked={injectSummaries}
                onChange={(checked) => {
                  setInjectSummaries(checked);
                  void setInjectionEnabled(checked);
                }}
              />
            </label>
            <a
              role="menuitem"
              className="ax-menu-item"
              href={`${WEB_APP_URL}/account`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              <Trans>Account settings</Trans>
            </a>
            <button
              type="button"
              role="menuitem"
              className="ax-menu-item"
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
            >
              <Trans>Sign out</Trans>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
