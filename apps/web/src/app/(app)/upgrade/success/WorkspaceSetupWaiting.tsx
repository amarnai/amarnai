"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function WorkspaceSetupWaiting() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.refresh(), 3000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="upgrade-success-page">
      <div className="upgrade-success-spinner" aria-hidden="true" />
      <p className="upgrade-success-body">Setting up your workspace…</p>
    </div>
  );
}
