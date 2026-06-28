"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trans } from "@lingui/react/macro";

export function WorkspaceSetupWaiting() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="upgrade-success-page">
      <div className="upgrade-success-spinner" aria-hidden="true" />
      <p className="upgrade-success-body"><Trans>Setting up your workspace…</Trans></p>
    </div>
  );
}
