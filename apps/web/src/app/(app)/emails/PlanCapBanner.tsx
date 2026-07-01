"use client";

import { useState } from "react";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { TOP_PLAN, getDraftQuotaResetsAt, formatQuotaResetDate } from "@amarnai/shared";
import type { SyncStatus } from "@/lib/api";

type Props = {
  syncStatus: SyncStatus;
};

/**
 * Shown when the historical backfill couldn't load everything, with a message that
 * adapts to WHY (see backfillLimitState): the initial import hit the plan cap
 * (CAPPED), the one monthly grace re-import hit it too (CAPPED_RETRY), or the whole
 * monthly allowance is spent so nothing more can import until the window rolls
 * (BLOCKED). Below the top tier, upgrading raises the cap; at the top tier the only
 * lever is the monthly refresh. Dismissible for the session.
 */
export function PlanCapBanner({ syncStatus }: Props) {
  const { _ } = useLingui();
  const [dismissed, setDismissed] = useState(false);

  const state = syncStatus?.backfillLimitState;
  if (!syncStatus || !state || state === "NONE" || dismissed) return null;

  const plan = syncStatus.workspacePlan;
  const isTopPlan = plan === TOP_PLAN;
  const refreshDate = formatQuotaResetDate(getDraftQuotaResetsAt().toISOString());

  const message =
    state === "BLOCKED"
      ? _(msg`You've used all of your ${plan} plan's email imports this month, including one retry. Imports refresh ${refreshDate}.`)
      : state === "CAPPED_RETRY"
        ? _(msg`Your retry import finished and is still capped by your ${plan} plan. Your next retry is available ${refreshDate}.`)
        : _(msg`Your ${plan} plan finished importing your most recent emails. Older ones beyond its limit weren't loaded.`);

  return (
    <div
      className="warning-box"
      style={{ margin: "12px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
    >
      <span>{message}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {!isTopPlan && (
          <Link href="/upgrade" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
            {state === "BLOCKED" ? <Trans>Upgrade to import now</Trans> : <Trans>Upgrade to load the rest</Trans>}
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
