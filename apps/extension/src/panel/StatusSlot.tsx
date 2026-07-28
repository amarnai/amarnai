import { Trans, Plural } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { InboxStatus } from "@amarnai/core/emails";
import type { PlanSetupMode } from "@amarnai/ui/plan-setup";
import { TOP_PLAN, getDraftQuotaResetsAt, formatQuotaResetDate } from "@amarnai/shared";
import { WEB_APP_URL } from "../config";

type Props = {
  status: InboxStatus | null;
  /** Route the whole waiting backlog (routeUnrouted + optimistic count reset). */
  onSort: () => void;
  onDismissPlanCap: () => void;
  /** Open the in-panel plan setup dialog (owned by EmailsPanel). */
  onOpenPlanSetup: (mode: PlanSetupMode) => void;
};

// The single pinned sorting-status row under the panel header. Which state to
// show (and with what counts) is decided by the shared resolveInboxStatus in
// @amarnai/core; this component owns only the 360px presentation. Two visual
// templates: an action row (inline CTA) and a notice row (dismissible, may wrap).
// Actions that need the plan editor or billing open the web app in a new tab.
export function StatusSlot({ status, onSort, onDismissPlanCap, onOpenPlanSetup }: Props) {
  const { _ } = useLingui();
  // The empty takeover is rendered full-pane by EmailsPanel, not in the slot.
  if (!status || status.kind === "no-plan-empty") return null;

  if (status.kind === "no-plan") {
    return (
      <div className="ax-status">
        <div className="ax-status-action">
          <span className="ax-status-text">
            <Plural
              value={status.waitingCount}
              one="# thread is waiting. Set up folders to start sorting."
              other="# threads are waiting. Set up folders to start sorting."
            />
          </span>
          <button
            type="button"
            className="ax-btn ax-btn-primary ax-status-btn"
            onClick={() => onOpenPlanSetup("choice")}
          >
            <Trans>Set up folders</Trans>
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === "pending") {
    return (
      <div className="ax-status">
        <div className="ax-status-action ax-status-action--ok">
          <span className="ax-status-text">
            <Plural value={status.waitingCount} one="# thread ready to sort" other="# threads ready to sort" />
          </span>
          <button type="button" className="ax-btn ax-btn-primary ax-status-btn" onClick={onSort}>
            <Trans>Sort</Trans>
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === "plan-cap") {
    const isTopPlan = status.plan === TOP_PLAN;
    const refreshDate = formatQuotaResetDate(getDraftQuotaResetsAt().toISOString());
    const message =
      status.limitState === "BLOCKED"
        ? _(msg`You've used all of your ${status.plan} plan's email imports this month, including one retry. Imports refresh ${refreshDate}.`)
        : status.limitState === "CAPPED_RETRY"
          ? _(msg`Your retry import finished and is still capped by your ${status.plan} plan. Your next retry is available ${refreshDate}.`)
          : _(msg`Your ${status.plan} plan finished importing your most recent emails. Older ones beyond its limit weren't loaded.`);

    return (
      <div className="ax-status">
        <div className="ax-status-notice">
          <span className="ax-status-text">{message}</span>
          <div className="ax-status-actions">
            {!isTopPlan && (
              <a
                className="ax-btn ax-btn-primary ax-status-btn"
                href={`${WEB_APP_URL}/upgrade`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {status.limitState === "BLOCKED" ? (
                  <Trans>Upgrade to import now</Trans>
                ) : (
                  <Trans>Upgrade to load the rest</Trans>
                )}
              </a>
            )}
            <button
              type="button"
              className="ax-status-x"
              onClick={onDismissPlanCap}
              aria-label={_(msg`Dismiss`)}
            >
              <svg
                width="14"
                height="14"
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
      </div>
    );
  }

  // Backfill running — the lowest-priority state. Reuses the shared em-backfill
  // styles (loaded via @amarnai/ui/emails/styles) so there is one source of
  // truth for the pulse + indeterminate bar; .ax-status neutralizes its margin.
  return (
    <div className="ax-status">
      <div className="em-backfill">
        <div className="em-backfill-eyebrow">
          <span className="em-pulse" />
          <Trans>Sorting historical inbox</Trans>
        </div>
        <div className="em-backfill-title">
          <Trans>Loading past threads…</Trans>
        </div>
        <div className="em-backfill-desc">
          {status.awaitingTaxonomy ? (
            <Trans>Your past threads are being loaded and will appear shortly.</Trans>
          ) : (
            <Trans>New threads will appear as they are sorted.</Trans>
          )}
        </div>
        <div className="em-backfill-progress-track">
          <div className="em-backfill-progress-bar em-backfill-progress-bar--indeterminate" />
        </div>
      </div>
    </div>
  );
}

// Full-pane takeover for the "empty inbox, no plan" exception: there is no list
// to pin a row over, so the whole pane becomes the plan-setup entry point. Both
// routes into the dialog are offered here (rather than one button into a choice
// screen) because this screen is the user's first stop after connecting, and
// the extra click is the whole cost of the decision.
export function NoPlanEmptyState({
  onOpenPlanSetup,
}: {
  onOpenPlanSetup: (mode: PlanSetupMode) => void;
}) {
  return (
    <div className="ax-center">
      <div className="ax-emptyplan-glyph" aria-hidden>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 7v10l9 4 9-4V7" />
          <path d="M12 11v10" />
        </svg>
      </div>
      <div className="ax-emptyplan-title">
        <Trans>Build your sorting plan</Trans>
      </div>
      <p className="ax-muted">
        <Trans>Set up folders so Amarnai knows where to file your mail. It only takes a minute.</Trans>
      </p>
      <div className="ax-emptyplan-actions">
        <button
          type="button"
          className="ax-btn ax-btn-primary"
          onClick={() => onOpenPlanSetup("generate")}
        >
          <Trans>Generate from inbox</Trans>
        </button>
        <button
          type="button"
          className="ax-btn ax-btn-secondary"
          onClick={() => onOpenPlanSetup("template")}
        >
          <Trans>Use a template</Trans>
        </button>
      </div>
      <a
        className="ax-linkbtn"
        href={`${WEB_APP_URL}/plan`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Trans>Fine-tune later in the plan editor</Trans>
      </a>
    </div>
  );
}
