"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { NavGlyph } from "@aziru/ui";
import { userInitials, workspaceInitials, workspaceHue } from "@aziru/core";

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

import { switchWorkspaceAction } from "@/actions/workspace";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { NotificationBell } from "@/components/NotificationBell";

const isDevEnabled = process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS === "true";

const isGmailDebugEnabled =
  process.env.NEXT_PUBLIC_ENABLE_GMAIL_DEBUG_TOOLS === "true";

const NAV: { href: string; label: MessageDescriptor; icon: React.ReactNode }[] = [
  { href: "/emails", label: msg`Emails`, icon: <NavGlyph name="emails" className="nav-icon" /> },
  { href: "/folders", label: msg`Folders`, icon: <NavGlyph name="taxonomy" className="nav-icon" /> },
  { href: "/settings", label: msg`Settings`, icon: <NavGlyph name="settings" className="nav-icon" /> },
  ...(isDevEnabled ? [{ href: "/dev/mock-inbox", label: msg`Mock Inbox`, icon: null }] : []),
  ...(isGmailDebugEnabled
    ? [{ href: "/dev/gmail-sort-tester", label: msg`Gmail Sort Tester`, icon: null }]
    : []),
];

function WorkspaceMark({ name }: { name: string }) {
  const hue = workspaceHue(name);
  const initials = workspaceInitials(name);
  return (
    <span
      className="ws-mark"
      aria-hidden
      style={{ "--ws-hue": hue } as React.CSSProperties}
    >
      {initials}
    </span>
  );
}

type SidebarWorkspace = { id: string; name: string };
type SidebarUser = { email: string; name: string | null } | null;

export function Sidebar({
  user,
  workspace,
  workspaces,
  hasFreeWorkspace,
}: {
  user: SidebarUser;
  workspace: SidebarWorkspace | null;
  workspaces: SidebarWorkspace[];
  hasFreeWorkspace: boolean;
}) {
  const { _ } = useLingui();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!wsOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setWsOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [wsOpen]);

  async function handleSwitch(id: string) {
    setWsOpen(false);
    await switchWorkspaceAction(id);
  }

  const initials = user ? userInitials(user.name, user.email) : "?";

  return (
    <>
      <button
        className="mobile-menu-btn"
        onClick={() => setMobileOpen(true)}
        aria-label={_(msg`Open navigation`)}
        aria-expanded={mobileOpen}
      >
        <HamburgerIcon />
      </button>

      {mobileOpen && (
        <div
          className="shell-overlay"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

    <aside className={`sidebar${mobileOpen ? " mobile-open" : ""}`}>
      {/* Brand + notification bell, then the workspace switcher on its own
          full-width row so long workspace names are not truncated. */}
      <div className="sidebar-top">
      <div className="sidebar-brand-row">
        <span className="sidebar-brand">
          <Image src="/logo.png" alt="" width={22} height={22} />
          Amarnai
        </span>
        <NotificationBell currentWorkspaceId={workspace?.id ?? null} />
      </div>
      <div
        className="ws-switcher"
        ref={dropdownRef}
        style={{ minWidth: 0 }}
      >
        <button
          className="ws-switcher-btn ws-switcher-btn--header"
          type="button"
          onClick={() => setWsOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={wsOpen}
        >
          <WorkspaceMark name={workspace?.name ?? "?"} />
          <span className="ws-switcher-name">
            {workspace?.name ?? _(msg`No workspace`)}
          </span>
          <span
            className={`ws-switcher-chevron${wsOpen ? " open" : ""}`}
            aria-hidden
          >
            ▾
          </span>
        </button>

        {wsOpen && (
          <div className="ws-dropdown" role="listbox">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                className={`ws-dropdown-item${ws.id === workspace?.id ? " active" : ""}`}
                role="option"
                aria-selected={ws.id === workspace?.id}
                type="button"
                onClick={() => handleSwitch(ws.id)}
              >
                {ws.name}
              </button>
            ))}

            <div className="ws-dropdown-separator" aria-hidden />
            <button
              type="button"
              className="ws-dropdown-new"
              onClick={() => {
                setWsOpen(false);
                setDialogOpen(true);
              }}
            >
              <Trans>+ New workspace</Trans>
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Nav */}
      <nav>
        <ul className="sidebar-nav">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={pathname.startsWith(item.href) ? "active" : ""}
              >
                {item.icon ?? <span className="nav-dot" aria-hidden />}
                {_(item.label)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer: user account link */}
      {user && (
        <div className="sidebar-footer">
          <Link href="/account" className="sidebar-user">
            <div className="sidebar-avatar" aria-hidden>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {user.name && (
                <span className="sidebar-user-name">{user.name}</span>
              )}
              <span className="sidebar-user-email">{user.email}</span>
            </div>
          </Link>
        </div>
      )}
    </aside>

    {dialogOpen && (
      <CreateWorkspaceDialog
        hasFreeWorkspace={hasFreeWorkspace}
        onClose={() => setDialogOpen(false)}
      />
    )}
    </>
  );
}
