"use client";

import { useEffect } from "react";
import Image from "next/image";
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
      <div className="upgrade-success-stage">
        <div className="upgrade-success-mascot">
          <Image
            src="/aziru-upgrade.png"
            alt="King Aziru"
            width={1254}
            height={1254}
            style={{ width: "100%", height: "auto" }}
            priority
          />
        </div>
        <div className="upgrade-success-card">
          <div className="upgrade-success-spinner" aria-hidden="true" />
          <h1 className="upgrade-success-title">
            <Trans>Setting up your workspace…</Trans>
          </h1>
          <p className="upgrade-success-body">
            <Trans>This only takes a moment.</Trans>
          </p>
        </div>
      </div>
    </div>
  );
}
