"use client";

import { useState } from "react";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg, plural } from "@lingui/core/macro";
import { TOP_PLAN, getDraftQuotaResetsAt, formatQuotaResetDate } from "@amarnai/shared";
import type { SyncStatus } from "@/lib/api";

type Props = {
  syncStatus: SyncStatus;
};

/**
 * Shown when the historical backfill stopped at the plan's thread cap with more
 * threads still in Gmail. Surfaces the approximate beyond-cap count. Below the top
 * tier it points to the upgrade flow (a higher plan re-runs the backfill up to the
 * larger cap); at the top tier there is no higher plan, so it tells the user when
 * the pooled monthly budget refreshes instead. Dismissible for the session.
 */
export function PlanCapBanner({ syncStatus }: Props) {
  const { _ } = useLingui();
  const [dismissed, setDismissed] = useState(false);

  if (!syncStatus || !syncStatus.backfillCapReached || dismissed) return null;

  const count = syncStatus.backfillBeyondCount;
  const plan = syncStatus.workspacePlan;
  const isTopPlan = plan === TOP_PLAN;
  const refreshDate = formatQuotaResetDate(getDraftQuotaResetsAt().toISOString());

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
        {isTopPlan ? (
          <span style={{ whiteSpace: "nowrap", fontSize: 13, color: "var(--color-muted)" }}>
            {_(msg`Refresh after ${refreshDate} to load more.`)}
          </span>
        ) : (
          <Link href="/upgrade" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
            <Trans>Upgrade to load the rest</Trans>
          </Link>
        )}
        <button
          type="button"
          className="plan-cap-close"
          onClick={() => setDismissed(true)}
          aria-label={_(msg`Dismiss`)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
