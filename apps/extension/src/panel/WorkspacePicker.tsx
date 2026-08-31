import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { NavGlyph, ThemeToggle } from "@aziru/ui";
import { userInitials } from "@aziru/core";
import { useSession } from "../auth/session";
import { useWebAppLink } from "./openWebApp";
import { NotificationBell } from "./NotificationBell";

// Slim panel header: workspace switcher, folders, workspace settings, and the
// user menu (account settings, sign out). At 320px there is no room for a full
// switcher UI, so a native <select> is used when the user belongs to more than
// one workspace. Folders open in-panel when the host supplies onOpenFolders;
// anything with no in-panel equivalent links out to the web app, which opens in
// a new tab already signed in (see useWebAppLink).
export function PanelHeader({
  onOpenFolders,
  onOpenSettings,
}: { onOpenFolders?: () => void; onOpenSettings?: () => void } = {}) {
  const { _ } = useLingui();
  const { user, workspaces, workspaceId, switchWorkspace, signOut } = useSession();
  const webAppLink = useWebAppLink();
  const active = workspaces.find((w) => w.id === workspaceId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const foldersLabel = _(msg`Folders`);
  const settingsLabel = _(msg`Workspace settings`);
  // Short visible label at wide panel widths; the tooltip/aria-label keeps the
  // unambiguous "Workspace settings".
  const settingsShortLabel = _(msg`Settings`);
  const accountLink = webAppLink("/account");

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
        <span className="ax-ws-name">{active?.name ?? "Aziru"}</span>
      )}

      <NotificationBell />

      {/* Editing folders is native to the panel; only surfaces that have no
          in-panel equivalent still link out to the web app. */}
      {onOpenFolders ? (
        <button
          type="button"
          className="ax-header-iconbtn"
          onClick={onOpenFolders}
          title={foldersLabel}
          aria-label={foldersLabel}
        >
          <NavGlyph name="taxonomy" />
          <span className="ax-iconbtn-label">{foldersLabel}</span>
        </button>
      ) : (
        <a
          className="ax-header-iconbtn"
          {...webAppLink("/folders")}
          title={foldersLabel}
          aria-label={foldersLabel}
        >
          <NavGlyph name="taxonomy" />
          <span className="ax-iconbtn-label">{foldersLabel}</span>
        </a>
      )}
      {onOpenSettings ? (
        <button
          type="button"
          className="ax-header-iconbtn"
          onClick={onOpenSettings}
          title={settingsLabel}
          aria-label={settingsLabel}
        >
          <NavGlyph name="settings" />
          <span className="ax-iconbtn-label">{settingsShortLabel}</span>
        </button>
      ) : (
        <a
          className="ax-header-iconbtn"
          {...webAppLink("/settings")}
          title={settingsLabel}
          aria-label={settingsLabel}
        >
          <NavGlyph name="settings" />
          <span className="ax-iconbtn-label">{settingsShortLabel}</span>
        </a>
      )}

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
            <a
              role="menuitem"
              className="ax-menu-item"
              {...accountLink}
              onClick={(e) => {
                setMenuOpen(false);
                accountLink.onClick(e);
              }}
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
