"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function WorkspaceSetupWaiting() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="upgrade-success-page">
      <div className="upgrade-success-spinner" aria-hidden="true" />
      <p className="upgrade-success-body">Setting up your workspace…</p>
    </div>
  );
}
