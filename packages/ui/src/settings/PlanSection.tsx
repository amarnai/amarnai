"use client";

import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { PLAN_TIER, TOP_PLAN, type BillingPlan } from "@amarnai/shared";
import { billingPlanLabel } from "../pricing/planLabel.js";
import "./settings.css";

export type PlanSectionProps = {
  /** The plan this workspace is on. Plans are per-workspace, not per-user. */
  plan: BillingPlan;
  /**
   * Whether this deployment sells plans at all. False on self-hosted installs
   * running without Stripe, where an upgrade could only fail.
   */
  billingEnabled: boolean;
  /** Only the workspace owner may change the plan; the API rejects anyone else. */
  isOwner: boolean;
  onUpgrade: () => void;
};

/**
 * Current plan, and the calm way to upgrade. The urgent path is the quota notice
 * in the thread list, which appears once imports are actually capped; this is
 * here so deciding to upgrade does not require first hitting a wall.
 *
 * Changing or cancelling a paid plan is deliberately not offered: those need
 * room to show what is lost, so they stay in the web app.
 */
export function PlanSection({ plan, billingEnabled, isOwner, onUpgrade }: PlanSectionProps) {
  const { i18n } = useLingui();

  const planLabel = billingPlanLabel(i18n, plan);

  const canUpgrade = billingEnabled && plan !== TOP_PLAN && PLAN_TIER[plan] < PLAN_TIER[TOP_PLAN];

  return (
    <section className="st-section">
      <h2 className="st-title">
        <Trans>Plan</Trans>
      </h2>
      <p className="st-hint">
        <Trans>This workspace is on {planLabel}.</Trans>
      </p>

      {canUpgrade && isOwner && (
        <div className="st-actions">
          <button type="button" className="st-btn st-btn--primary" onClick={onUpgrade}>
            <Trans>Upgrade</Trans>
          </button>
        </div>
      )}

      {canUpgrade && !isOwner && (
        <p className="st-hint">
          <Trans>Ask the workspace owner to change the plan.</Trans>
        </p>
      )}
    </section>
  );
}
