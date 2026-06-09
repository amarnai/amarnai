import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div className="page-404">
      <Link href="/" className="page-404-nav">
        <Image src="/logo.png" alt="Amarnai" width={28} height={28} />
        <span className="page-404-nav-name">Amarnai</span>
      </Link>

      <div className="page-404-center">
        <div className="page-404-stage">
          <div className="page-404-mascot">
            <Image
              src="/aziru-404.png"
              alt="King Aziru"
              width={1122}
              height={1402}
              style={{ width: "100%", height: "auto" }}
              priority
            />
          </div>
          <div className="page-404-card">
            <p className="page-404-code">404</p>
            <h1 className="page-404-heading">This page wasn&apos;t found</h1>
            <p className="page-404-subtext">
              King Aziru has consulted every clay tablet in his archive, but
              this page does not appear to exist.
            </p>
            <Link
              href="/"
              className="btn-primary"
              style={{ textDecoration: "none" }}
            >
              Go home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
