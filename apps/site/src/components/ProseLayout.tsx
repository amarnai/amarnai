import Link from "next/link";
import Image from "next/image";

export function ProseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="prose-page">
      <header className="prose-header">
        <Link href="/" className="prose-brand">
          <Image src="/logo.png" alt="Amarnai" width={28} height={28} />
          <span>Amarnai</span>
        </Link>
        <Link href="/" className="prose-back">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M11 7H3M6.5 3.5 3 7l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to home
        </Link>
      </header>

      <main className="prose-body">{children}</main>

      <footer className="prose-footer">
        <p>&copy; {new Date().getFullYear()} Amarnai. All rights reserved.</p>
        <div className="prose-footer-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </footer>
    </div>
  );
}
