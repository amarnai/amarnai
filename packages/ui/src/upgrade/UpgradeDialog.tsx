import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import {
  PLANS,
  PLAN_TIER,
  PLAN_TO_BILLING,
  type BillingCycle,
  type BillingPlan,
  type PlanId,
} from "@aziru/shared";
import { trPlan } from "../pricing/planMessages.js";
import { Switch } from "../Switch.js";
import { UpgradeSuccess } from "./UpgradeSuccess.js";

/** A plan that can actually be paid for. Free is never an upgrade target. */
export type PaidPlanId = Exclude<PlanId, "free">;

export type StartCheckoutInput = {
  action: "upgrade" | "create";
  plan: PaidPlanId;
  cycle: BillingCycle;
  workspaceId?: string;
  newWorkspaceName?: string;
};

export type StartCheckoutOutcome = {
  ok: boolean;
  status: number;
  data: { url?: string; upgraded?: boolean; sessionId?: string; error?: string };
};

export type UpgradeDialogProps = {
  workspaceId: string;
  /** Named in the success card, so the user sees what they just paid for. */
  workspaceName: string;
  /** The Aziru artwork, served by whichever surface is hosting this. */
  mascotSrc: string;
  /** The plan this workspace is on today, so its own tier is not offered back. */
  currentPlan: BillingPlan;
  /**
   * Create a Stripe Checkout session, or apply a paid-to-paid change directly.
   * Injected because billing lives on the web app's routes, not the API client
   * this package otherwise talks to.
   */
  startCheckout: (input: StartCheckoutInput) => Promise<StartCheckoutOutcome>;
  /**
   * Hand the host a Checkout session to open. The host owns how that happens
   * (the extension carries its session across with a one-time code first), and
   * remembers the id so the result can be confirmed on return.
   */
  onCheckoutStarted: (checkout: { sessionId: string; url: string }) => void;
  /** A paid-to-paid change applied with no payment step. */
  onUpgraded: () => void;
  onClose: () => void;
};

/**
 * Plan picker sized for the 360px extension panel: a cycle toggle and one card
 * per paid plan, over the same PLANS data the marketing site uses. The full
 * comparison matrix (PricingPlans) does not fit here and is not what someone who
 * just hit a quota needs.
 *
 * Downgrading and cancelling are deliberately absent. They live in the web app,
 * where the consequences (losing seats, losing history) can be shown properly.
 */
export function UpgradeDialog({
  workspaceId,
  workspaceName,
  mascotSrc,
  currentPlan,
  startCheckout,
  onCheckoutStarted,
  onUpgraded,
  onClose,
}: UpgradeDialogProps) {
  const { _, i18n } = useLingui();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<PaidPlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgraded, setUpgraded] = useState<PaidPlanId | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Only plans above the current tier are offered. Creating a separate workspace
  // is the exception: that workspace starts at Free, so every paid plan is open.
  const offered = useMemo(
    () =>
      PLANS.filter((plan) => {
        if (plan.free) return false;
        if (newWorkspace) return true;
        return PLAN_TIER[PLAN_TO_BILLING[plan.id]] > PLAN_TIER[currentPlan];
      }),
    [currentPlan, newWorkspace]
  );

  const handleSelect = useCallback(
    async (plan: PaidPlanId) => {
      if (busy) return;
      const name = newName.trim();
      if (newWorkspace && !name) {
        setError(_(msg`Enter a name for the new workspace.`));
        return;
      }

      setBusy(plan);
      setError(null);
      try {
        const res = await startCheckout({
          action: newWorkspace ? "create" : "upgrade",
          plan,
          cycle,
          ...(newWorkspace ? { newWorkspaceName: name } : { workspaceId }),
        });

        if (!res.ok) {
          // Prefer the server's own words. A 403 here is not always about
          // ownership (an unverified email refuses the same way), and guessing
          // sent people looking for a permissions problem they did not have.
          setError(
            res.data.error ??
              (res.status === 403
                ? _(msg`You do not have permission to change this plan.`)
                : _(msg`Something went wrong. Please try again.`))
          );
          return;
        }

        // A paid-to-paid change is applied server-side with no payment step.
        if (res.data.upgraded) {
          setUpgraded(plan);
          onUpgraded();
          return;
        }

        if (res.data.url && res.data.sessionId) {
          onCheckoutStarted({ sessionId: res.data.sessionId, url: res.data.url });
          return;
        }

        setError(_(msg`Something went wrong. Please try again.`));
      } catch {
        setError(_(msg`Could not reach the billing service. Please try again.`));
      } finally {
        setBusy(null);
      }
    },
    [
      busy,
      cycle,
      newName,
      newWorkspace,
      onCheckoutStarted,
      onUpgraded,
      startCheckout,
      workspaceId,
      _,
    ]
  );

  return (
    <div className="ug-overlay">
      <div className="ug-dialog" role="dialog" aria-modal="true">
        <div className="ug-head">
          <h2 className="ug-title">
            <Trans>Upgrade</Trans>
          </h2>
          <button type="button" className="ug-close" onClick={onClose} aria-label={_(msg`Close`)}>
            ×
          </button>
        </div>

        <div className="ug-body">
          {error && (
            <p className="ug-error" role="alert">
              {error}
            </p>
          )}

          {upgraded ? (
            <UpgradeSuccess
              mascotSrc={mascotSrc}
              planLabel={trPlan(
                i18n,
                PLANS.find((p) => p.id === upgraded)?.name ?? upgraded
              )}
              workspaceName={workspaceName}
            >
              <div className="ug-success-actions">
                <button type="button" className="ug-btn ug-btn--primary" onClick={onClose}>
                  <Trans>Done</Trans>
                </button>
              </div>
            </UpgradeSuccess>
          ) : (
            <>
              <div className="ug-cycle" role="group" aria-label={_(msg`Billing cycle`)}>
                <button
                  type="button"
                  className={`ug-cycle-btn${cycle === "monthly" ? " is-active" : ""}`}
                  onClick={() => setCycle("monthly")}
                  aria-pressed={cycle === "monthly"}
                >
                  <Trans>Monthly</Trans>
                </button>
                <button
                  type="button"
                  className={`ug-cycle-btn${cycle === "annual" ? " is-active" : ""}`}
                  onClick={() => setCycle("annual")}
                  aria-pressed={cycle === "annual"}
                >
                  <Trans>Annual, save 20%</Trans>
                </button>
              </div>

              {offered.map((plan) => {
                const price = cycle === "annual" ? plan.annualMonthlyPrice : plan.monthlyPrice;
                const planName = trPlan(i18n, plan.name);
                return (
                  <div
                    key={plan.id}
                    className={`ug-card${plan.featured ? " ug-card--featured" : ""}`}
                  >
                    <div className="ug-card-head">
                      <span className="ug-card-name">{planName}</span>
                      {plan.badge && <span className="ug-badge">{trPlan(i18n, plan.badge)}</span>}
                    </div>
                    <p className="ug-price">
                      <Trans>${price} per month</Trans>
                    </p>
                    <p className="ug-price-note">
                      <Trans>Taxes calculated at checkout</Trans>
                    </p>
                    <ul className="ug-highlights">
                      {plan.highlights.map((h) => (
                        <li key={h}>{trPlan(i18n, h)}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="ug-btn ug-btn--primary"
                      disabled={busy !== null}
                      onClick={() => void handleSelect(plan.id as PaidPlanId)}
                    >
                      {busy === plan.id ? (
                        <Trans>Opening checkout</Trans>
                      ) : (
                        <Trans>Choose {planName}</Trans>
                      )}
                    </button>
                  </div>
                );
              })}

              {offered.length === 0 && (
                <p className="ug-lead">
                  <Trans>This workspace is already on the highest plan.</Trans>
                </p>
              )}

              <div className="ug-alt">
                <label className="ug-alt-toggle">
                  <Switch
                    checked={newWorkspace}
                    onChange={(checked) => {
                      setNewWorkspace(checked);
                      setError(null);
                    }}
                  />
                  <Trans>Use this plan for a new workspace instead</Trans>
                </label>
                {newWorkspace && (
                  <input
                    type="text"
                    className="ug-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={_(msg`New workspace name`)}
                    aria-label={_(msg`New workspace name`)}
                    maxLength={100}
                  />
                )}
                <p className="ug-note">
                  <Trans>
                    Changing or cancelling a paid plan is done in your subscription settings.
                  </Trans>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
