"use client";

import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { PLANS, PLAN_TIER, PLAN_TO_BILLING, TOP_PLAN, type BillingPlan } from "@amarnai/shared";
import { trPlan } from "../pricing/planMessages.js";
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

  // The marketing name ("Scribe"), resolved through the same render-edge
  // localization the pricing table uses.
  const marketing = PLANS.find((p) => PLAN_TO_BILLING[p.id] === plan);
  const planLabel = marketing ? trPlan(i18n, marketing.name) : plan;

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
