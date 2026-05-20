"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/actions/auth";

const isDevEnabled =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS === "true";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/taxonomy", label: "Taxonomy" },
  { href: "/review", label: "Review Queue" },
  { href: "/emails", label: "Emails" },
  { href: "/tags", label: "Tags" },
  ...(isDevEnabled ? [{ href: "/dev/mock-inbox", label: "Mock Inbox" }] : []),
];

type SidebarUser = { email: string; name: string | null } | null;

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Genizor</div>
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
      {user && (
        <div className="sidebar-user">
          <div className="sidebar-user-email" title={user.email}>
            {user.name ?? user.email}
          </div>
          <form action={signOutAction}>
            <button className="btn-ghost sidebar-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
