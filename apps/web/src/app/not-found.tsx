import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";

export default function NotFound() {
  return (
    <AuthShell title="Page not found">
      <p
        style={{
          fontSize: "64px",
          fontWeight: 700,
          color: "var(--accent)",
          margin: "4px 0 8px",
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        404
      </p>
      <Link
        href="/"
        className="btn-primary auth-submit"
        style={{ textDecoration: "none", textAlign: "center", display: "block" }}
      >
        Go home
      </Link>
    </AuthShell>
  );
}
