import Link from "next/link";

export default function NotFound() {
  return (
    <div className="sign-in-page">
      <div className="sign-in-card">
        <h1 className="sign-in-title">Amarnai</h1>
        <p className="sign-in-subtitle">AI email triage assistant</p>
        <p
          style={{
            fontSize: "64px",
            fontWeight: 700,
            color: "var(--color-primary)",
            margin: "8px 0 4px",
            lineHeight: 1,
          }}
        >
          404
        </p>
        <p
          style={{
            fontSize: "15px",
            color: "var(--color-text-secondary)",
            marginBottom: "24px",
          }}
        >
          Page not found
        </p>
        <Link href="/" className="btn-primary" style={{ display: "block", textDecoration: "none" }}>
          Go home
        </Link>
      </div>
    </div>
  );
}
