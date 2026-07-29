import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { UpgradeSuccess, billingPlanLabel } from "@amarnai/ui/upgrade";
import { MASCOT_SRC } from "./assets";

type Props = {
  /** The stored plan value the checkout landed on, e.g. "BUSINESS". */
  plan: string;
  /** The workspace the plan landed on, which may not be the current one. */
  purchasedWorkspaceId: string;
  purchasedWorkspaceName: string;
  currentWorkspaceId: string;
  onSwitchWorkspace: (workspaceId: string) => void;
  onDone: () => void;
};

/**
 * Success for a checkout that ran in a browser tab. The dialog was closed the
 * moment the user left for Stripe, so without this the upgrade would land in
 * silence: limits change, the quota notice vanishes, and nothing says why.
 *
 * A plan bought for a different workspace gets different copy and an action,
 * because "your plan is updated" would be untrue of the workspace the user is
 * actually looking at.
 */
export function UpgradeSuccessOverlay({
  plan,
  purchasedWorkspaceId,
  purchasedWorkspaceName,
  currentWorkspaceId,
  onSwitchWorkspace,
  onDone,
}: Props) {
  const { i18n } = useLingui();
  const isOtherWorkspace = purchasedWorkspaceId !== currentWorkspaceId;

  return (
    <div className="ug-overlay">
      <div className="ug-dialog">
        <div className="ug-body">
          <UpgradeSuccess
            mascotSrc={MASCOT_SRC}
            planLabel={billingPlanLabel(i18n, plan)}
            workspaceName={purchasedWorkspaceName}
            isOtherWorkspace={isOtherWorkspace}
          >
            <div className="ug-success-actions">
              {isOtherWorkspace && (
                <button
                  type="button"
                  className="ug-btn ug-btn--primary"
                  onClick={() => onSwitchWorkspace(purchasedWorkspaceId)}
                >
                  <Trans>Switch to it</Trans>
                </button>
              )}
              <button
                type="button"
                className={isOtherWorkspace ? "ug-btn" : "ug-btn ug-btn--primary"}
                onClick={onDone}
              >
                <Trans>Done</Trans>
              </button>
            </div>
          </UpgradeSuccess>
        </div>
      </div>
    </div>
  );
}
