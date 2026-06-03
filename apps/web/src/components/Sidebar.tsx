"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function EmailsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="nav-icon">
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.5 5.5l6.5 4.5 6.5-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TaxonomyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="nav-icon">
      <rect x="1" y="5.75" width="4.5" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="2.75" width="4.5" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="8.75" width="4.5" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7H8V4H10M8 7V10H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="nav-icon">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9.46 1.15 9.04 3.11A5 5 0 0 1 11.72 4.65L13.2 3.32A7 7 0 0 1 14.66 5.84L12.76 6.46A5 5 0 0 1 12.76 9.55L14.66 10.16A7 7 0 0 1 13.2 12.69L11.72 11.35A5 5 0 0 1 9.04 12.89L9.46 14.85A7 7 0 0 1 6.54 14.85L6.96 12.89A5 5 0 0 1 4.28 11.35L2.8 12.69A7 7 0 0 1 1.34 10.16L3.25 9.55A5 5 0 0 1 3.25 6.46L1.34 5.84A7 7 0 0 1 2.8 3.32L4.28 4.65A5 5 0 0 1 6.96 3.11L6.54 1.15A7 7 0 0 1 9.46 1.15Z M8 5.7A2.3 2.3 0 1 0 8 10.3A2.3 2.3 0 1 0 8 5.7Z"
      />
    </svg>
  );
}

import {
  switchWorkspaceAction,
  createWorkspaceAction,
} from "@/actions/workspace";

const isDevEnabled = process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS === "true";

const isGmailDebugEnabled =
  process.env.NEXT_PUBLIC_ENABLE_GMAIL_DEBUG_TOOLS === "true";

const NAV = [
  { href: "/emails", label: "Emails", icon: <EmailsIcon /> },
  { href: "/taxonomy", label: "Taxonomy", icon: <TaxonomyIcon /> },
  { href: "/settings", label: "Settings", icon: <SettingsIcon /> },
  ...(isDevEnabled ? [{ href: "/dev/mock-inbox", label: "Mock Inbox", icon: null }] : []),
  ...(isGmailDebugEnabled
    ? [{ href: "/dev/gmail-sort-tester", label: "Gmail Sort Tester", icon: null }]
    : []),
];

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? "";
    if (parts.length >= 2)
      return ((first.at(0) ?? "") + (last.at(0) ?? "")).toUpperCase();
    return first.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function getWorkspaceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]!.at(0) ?? "") + (parts[parts.length - 1]!.at(0) ?? "")).toUpperCase();
  }
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

// Deterministic hue from workspace name for visual differentiation
function getWorkspaceHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function WorkspaceMark({ name }: { name: string }) {
  const hue = getWorkspaceHue(name);
  const initials = getWorkspaceInitials(name);
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
  canCreateWorkspace,
}: {
  user: SidebarUser;
  workspace: SidebarWorkspace | null;
  workspaces: SidebarWorkspace[];
  canCreateWorkspace: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

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
        setCreating(false);
        setCreateName("");
        setCreateError(null);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [wsOpen]);

  useEffect(() => {
    if (creating) {
      createInputRef.current?.focus();
    }
  }, [creating]);

  async function handleSwitch(id: string) {
    setWsOpen(false);
    await switchWorkspaceAction(id);
  }

  function handleOpenCreate() {
    setCreating(true);
    setCreateError(null);
    setCreateName("");
  }

  async function handleCreate() {
    if (!createName.trim()) return;
    setCreatePending(true);
    setCreateError(null);
    const result = await createWorkspaceAction(createName);
    if (result?.error) {
      setCreateError(result.error);
      setCreatePending(false);
    }
  }

  function handleCancelCreate() {
    setCreating(false);
    setCreateName("");
    setCreateError(null);
  }

  const initials = user ? getInitials(user.name, user.email) : "?";

  return (
    <>
      <button
        className="mobile-menu-btn"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
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
      {/* Workspace switcher — top of sidebar, replaces brand header */}
      <div
        className="ws-switcher"
        ref={dropdownRef}
        style={{ marginBottom: 8 }}
      >
        <button
          className="ws-switcher-btn ws-switcher-btn--header"
          type="button"
          onClick={() => {
            if (wsOpen) {
              setWsOpen(false);
              setCreating(false);
              setCreateName("");
              setCreateError(null);
            } else {
              setWsOpen(true);
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={wsOpen}
        >
          <WorkspaceMark name={workspace?.name ?? "?"} />
          <span className="ws-switcher-name">
            {workspace?.name ?? "No workspace"}
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

            {canCreateWorkspace && (
              <>
                <div className="ws-dropdown-separator" aria-hidden />
                {!creating ? (
                  <button
                    type="button"
                    className="ws-dropdown-new"
                    onClick={handleOpenCreate}
                  >
                    + New workspace
                  </button>
                ) : (
                  <div className="ws-create-form">
                    <input
                      ref={createInputRef}
                      type="text"
                      className="ws-create-input"
                      placeholder="Workspace name"
                      value={createName}
                      maxLength={100}
                      onChange={(e) => setCreateName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreate();
                        if (e.key === "Escape") handleCancelCreate();
                      }}
                    />
                    {createError && (
                      <p className="ws-create-error">{createError}</p>
                    )}
                    <div className="ws-create-actions">
                      <button
                        type="button"
                        className="ws-create-submit"
                        onClick={handleCreate}
                        disabled={createPending || !createName.trim()}
                      >
                        {createPending ? "Creating…" : "Create"}
                      </button>
                      <button
                        type="button"
                        className="ws-create-cancel"
                        onClick={handleCancelCreate}
                        disabled={createPending}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
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
                {item.label}
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
    </>
  );
}
