"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Invisible component that calls router.refresh() every 2.5 s while `active`
 * is true. Mount it in a server page when one or more threads are being
 * classified so the UI updates without a manual reload.
 */
export function ClassifyingRefresher({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(id);
  }, [active, router]);

  return null;
}
