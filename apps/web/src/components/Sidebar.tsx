"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function Sidebar() {
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
    </aside>
  );
}
