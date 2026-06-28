"use client";

import { useState } from "react";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg, plural } from "@lingui/core/macro";
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
  const { _ } = useLingui();
  const [dismissed, setDismissed] = useState(false);

  if (!syncStatus || !syncStatus.backfillCapReached || dismissed) return null;

  const count = syncStatus.backfillBeyondCount;
  const plan = syncStatus.workspacePlan;

  return (
    <div
      className="warning-box"
      style={{ margin: "12px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
    >
      <span>
        {count > 0
          ? _(
              msg`About ${plural(count, {
                one: "# more thread",
                other: "# more threads",
              })} beyond your ${plan} subscription limit aren't loaded.`
            )
          : _(msg`More threads beyond your ${plan} subscription limit aren't loaded.`)}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Link href="/upgrade" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
          <Trans>Upgrade to load them</Trans>
        </Link>
        <button
          type="button"
          className="em-toast-close"
          onClick={() => setDismissed(true)}
          aria-label={_(msg`Dismiss`)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
