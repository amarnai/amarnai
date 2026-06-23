"use client";

import { useState } from "react";
import Link from "next/link";
import type { SyncStatus } from "@/lib/api";

type Props = {
  syncStatus: SyncStatus;
};

/**
 * Shown when the historical backfill stopped at the plan's thread cap with more
 * threads still in Gmail. Surfaces the approximate beyond-cap count and points to
 * the upgrade flow (a higher plan re-runs the backfill up to the larger cap).
 * Dismissible for the session.
 */
export function PlanCapBanner({ syncStatus }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (!syncStatus || !syncStatus.backfillCapReached || dismissed) return null;

  const count = syncStatus.backfillBeyondCount;
  // The count is Gmail's estimate, so phrase it approximately.
  const countLabel = count > 0 ? `About ${count.toLocaleString()} more thread${count === 1 ? "" : "s"}` : "More threads";

  return (
    <div
      className="warning-box"
      style={{ margin: "12px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
    >
      <span>
        {countLabel} beyond your {syncStatus.workspacePlan} plan limit aren&apos;t loaded.
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Link href="/upgrade" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
          Upgrade to load them
        </Link>
        <button
          type="button"
          className="em-toast-close"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
