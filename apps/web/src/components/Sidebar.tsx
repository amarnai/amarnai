"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { switchWorkspaceAction } from "@/actions/workspace";

const isDevEnabled =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS === "true";

const isGmailDebugEnabled =
  process.env.NEXT_PUBLIC_ENABLE_GMAIL_DEBUG_TOOLS === "true";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/taxonomy", label: "Taxonomy" },
  { href: "/review", label: "Review Queue" },
  { href: "/emails", label: "Emails" },
  { href: "/settings", label: "Workspace" },
  ...(isDevEnabled ? [{ href: "/dev/mock-inbox", label: "Mock Inbox" }] : []),
  ...(isGmailDebugEnabled
    ? [{ href: "/dev/gmail-sort-tester", label: "Gmail Sort Tester" }]
    : []),
];

type SidebarWorkspace = { id: string; name: string };
type SidebarUser = { email: string; name: string | null } | null;

export function Sidebar({
  user,
  workspace,
  workspaces,
}: {
  user: SidebarUser;
  workspace: SidebarWorkspace | null;
  workspaces: SidebarWorkspace[];
}) {
  const pathname = usePathname();
  const [wsOpen, setWsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wsOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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

  const hasMultiple = workspaces.length > 1;

  return (
    <aside className="sidebar">
      {/* Workspace switcher */}
      <div className="ws-switcher" ref={dropdownRef}>
        <button
          className="ws-switcher-btn"
          type="button"
          onClick={() => hasMultiple && setWsOpen((o) => !o)}
          aria-haspopup={hasMultiple ? "listbox" : undefined}
          aria-expanded={wsOpen}
        >
          <span className="ws-switcher-name">{workspace?.name ?? "No workspace"}</span>
          {hasMultiple && (
            <span className={`ws-switcher-chevron${wsOpen ? " open" : ""}`} aria-hidden>
              ▾
            </span>
          )}
        </button>

        {wsOpen && hasMultiple && (
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
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* User → account link */}
      {user && (
        <Link href="/account" className="sidebar-user sidebar-user-link">
          <span className="sidebar-user-name">{user.name ?? user.email}</span>
          {user.name && (
            <span className="sidebar-user-email">{user.email}</span>
          )}
        </Link>
      )}
    </aside>
  );
}
