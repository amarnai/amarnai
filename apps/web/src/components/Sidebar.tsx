"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  switchWorkspaceAction,
  createWorkspaceAction,
} from "@/actions/workspace";

const isDevEnabled = process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS === "true";

const isGmailDebugEnabled =
  process.env.NEXT_PUBLIC_ENABLE_GMAIL_DEBUG_TOOLS === "true";

const NAV = [
  { href: "/emails", label: "Emails" },
  { href: "/taxonomy", label: "Taxonomy" },
  { href: "/settings", label: "Settings" },
  ...(isDevEnabled ? [{ href: "/dev/mock-inbox", label: "Mock Inbox" }] : []),
  ...(isGmailDebugEnabled
    ? [{ href: "/dev/gmail-sort-tester", label: "Gmail Sort Tester" }]
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
  const [wsOpen, setWsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

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
    <aside className="sidebar">
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
          <div className="sidebar-brand-mark" aria-hidden />
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
                <span className="nav-dot" aria-hidden />
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
  );
}
