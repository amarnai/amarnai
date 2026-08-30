"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SOURCE_LOCALE } from "@aziru/i18n";

// The source locale is served at the bare path (`/`, `/pricing`, ...), not under
// `/{locale}`. But `output: export` requires every `[locale]` param to be
// generated, so `/{SOURCE_LOCALE}/*` routes still exist as thin shells that
// immediately forward to their bare equivalent (`/en/pricing` -> `/pricing`).
// This keeps direct hits and stale links working instead of hitting a hard
// export error, while the bare path stays the canonical content page.
export function SourceLocaleRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const prefix = `/${SOURCE_LOCALE}`;
    const bare = pathname.startsWith(prefix)
      ? pathname.slice(prefix.length) || "/"
      : "/";
    router.replace(bare);
  }, [router, pathname]);

  return null;
}
