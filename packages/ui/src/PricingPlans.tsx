"use client";

import React, { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { I18n } from "@lingui/core";
import {
  PLANS,
  FEATURE_GROUPS,
  SELF_HOST_NOTE,
  type PlanId,
  type BillingCycle,
  type CellValue,
} from "./plans.js";
import { trPlan } from "./pricing/planMessages.js";

interface Props {
  currentPlan?: PlanId;
  trialUsed?: boolean;
  onSelectPlan?: (plan: PlanId, cycle: BillingCycle) => void;
  className?: string;
  showMatrix?: boolean;
  showSelfHost?: boolean;
}

function TickIcon() {
  return (
    <svg
      className="plan-tick"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.2 8.4 6.4 11.4 12.8 4.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CellYes() {
  const { _ } = useLingui();
  return (
    <span className="cell-yes" role="img" aria-label={_(msg`Included`)}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3.4 8.4 6.4 11.2 12.6 4.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function CellSoon({ label }: { label: string }) {
  return (
    <span className="cell-soon">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.1" />
        <path
          d="M6 3.6V6l1.6 1"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </span>
  );
}

function Cell({ value }: { value: CellValue }) {
  const { i18n, _ } = useLingui();
  if (value === true) return <CellYes />;
  if (value === false) return <span className="cell-no" role="img" aria-label={_(msg`Not included`)} />;
  if (typeof value === "object") {
    if ("soon" in value) return <CellSoon label={trPlan(i18n, value.soon)} />;
    if ("note" in value) return <span className="note">{trPlan(i18n, value.note)}</span>;
  }
  return <span>{trPlan(i18n, value as string)}</span>;
}

function BillingToggle({
  cycle,
  onChange,
}: {
  cycle: BillingCycle;
  onChange: (c: BillingCycle) => void;
}) {
  const { _ } = useLingui();
  return (
    <div className="plans-billing">
      <div className="plans-seg" role="tablist" aria-label={_(msg`Billing cycle`)}>
        <button
          role="tab"
          aria-selected={cycle === "monthly"}
          className={cycle === "monthly" ? "on" : ""}
          onClick={() => onChange("monthly")}
        >
          <Trans>Monthly</Trans>
        </button>
        <button
          role="tab"
          aria-selected={cycle === "annual"}
          className={cycle === "annual" ? "on" : ""}
          onClick={() => onChange("annual")}
        >
          <Trans>Annual</Trans>
        </button>
      </div>
      <span
        className="plans-save"
        onClick={cycle === "monthly" ? () => onChange("annual") : undefined}
        role={cycle === "monthly" ? "button" : undefined}
        tabIndex={cycle === "monthly" ? 0 : undefined}
        onKeyDown={cycle === "monthly" ? (e) => e.key === "Enter" && onChange("annual") : undefined}
        style={cycle === "monthly" ? { cursor: "pointer" } : undefined}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 1.4 8.7 4.9l3.9.5-2.8 2.7.7 3.8L7 10.1 3.5 11.9l.7-3.8L1.4 5.4l3.9-.5L7 1.4Z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
        <Trans>Save up to 20% annually</Trans>
      </span>
    </div>
  );
}

function PlanPrice({ plan, cycle }: { plan: (typeof PLANS)[number]; cycle: BillingCycle }) {
  if (plan.free) {
    return (
      <>
        <div className="plan-price">
          <span className="amount"><Trans>Free</Trans></span>
        </div>
        <div className="plan-pricenote"><Trans>Free forever · self-serve</Trans></div>
      </>
    );
  }
  const amount = cycle === "annual" ? plan.annualMonthlyPrice : plan.monthlyPrice;
  const pct = plan.monthlyPrice
    ? Math.round(((plan.monthlyPrice - plan.annualMonthlyPrice) / plan.monthlyPrice) * 100)
    : 0;
  return (
    <>
      <div className="plan-price">
        <span className="cur">$</span>
        <span className="amount">{amount}</span>
        <span className="per"><Trans>/ workspace / month</Trans></span>
      </div>
      <div className="plan-pricenote">
        {cycle === "annual" ? (
          <Trans>
            Billed annually · <span className="ann">save {pct}%</span>
          </Trans>
        ) : (
          <Trans>Billed monthly · 14-day free trial</Trans>
        )}
      </div>
      <div className="plan-pricenote"><Trans>Taxes calculated at checkout</Trans></div>
</>
  );
}

function getPlanCtaLabel(
  i18n: I18n,
  plan: (typeof PLANS)[number],
  isCurrent: boolean,
  isLowerThanCurrent: boolean,
  trialUsed: boolean,
): string {
  const planName = trPlan(i18n, plan.name);
  if (isCurrent) return i18n._(msg`Current subscription`);
  if (isLowerThanCurrent) return i18n._(msg`Downgrade to ${planName}`);
  if (trialUsed && !plan.free) return i18n._(msg`Upgrade to ${planName}`);
  return trPlan(i18n, plan.cta.label);
}

function PlanCtaButton({
  plan,
  cycle,
  isCurrent,
  isLowerThanCurrent,
  trialUsed,
  onSelect,
  baseClass,
}: {
  plan: (typeof PLANS)[number];
  cycle: BillingCycle;
  isCurrent: boolean;
  isLowerThanCurrent: boolean;
  trialUsed: boolean;
  onSelect?: (plan: PlanId, cycle: BillingCycle) => void;
  baseClass: string;
}) {
  const { i18n } = useLingui();
  const className = [baseClass, plan.cta.kind === "primary" ? "primary" : ""].filter(Boolean).join(" ");
  return (
    <button
      className={className}
      disabled={isCurrent}
      onClick={() => !isCurrent && onSelect?.(plan.id, cycle)}
    >
      {getPlanCtaLabel(i18n, plan, isCurrent, isLowerThanCurrent, trialUsed)}
    </button>
  );
}

function PlanCard({
  plan,
  cycle,
  isCurrent,
  isFeatured,
  showBadge,
  trialUsed,
  isLowerThanCurrent,
  onSelect,
}: {
  plan: (typeof PLANS)[number];
  cycle: BillingCycle;
  isCurrent: boolean;
  isFeatured: boolean;
  showBadge: boolean;
  trialUsed: boolean;
  isLowerThanCurrent: boolean;
  onSelect?: (plan: PlanId, cycle: BillingCycle) => void;
}) {
  const { i18n } = useLingui();
  const cardClass = ["plan-card", isFeatured ? "featured" : "", isCurrent ? "current" : ""].filter(Boolean).join(" ");
  return (
    <div className={cardClass}>
      {showBadge && plan.badge && <span className="plan-badge">{trPlan(i18n, plan.badge)}</span>}
      <div className="plan-name">{trPlan(i18n, plan.name)}</div>
      <div className="plan-tagline">{trPlan(i18n, plan.tagline)}</div>
      <PlanPrice plan={plan} cycle={cycle} />
      <PlanCtaButton
        plan={plan}
        cycle={cycle}
        isCurrent={isCurrent}
        isLowerThanCurrent={isLowerThanCurrent}
        trialUsed={trialUsed}
        {...(onSelect !== undefined ? { onSelect } : {})}
        baseClass="plan-cta"
      />
      <ul className="plan-hl">
        {plan.highlights.map((h) => (
          <li key={h}>
            <TickIcon />
            {trPlan(i18n, h)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonMatrix({
  cycle,
  featuredPlanId,
  onSelectPlan,
  currentPlan,
  trialUsed = false,
  currentIdx,
}: {
  cycle: BillingCycle;
  featuredPlanId?: PlanId | null;
  onSelectPlan?: (plan: PlanId, cycle: BillingCycle) => void;
  currentPlan?: PlanId;
  trialUsed?: boolean;
  currentIdx: number;
}) {
  const { i18n, _ } = useLingui();
  const featuredIdx =
    featuredPlanId === null
      ? -1
      : featuredPlanId !== undefined
      ? PLANS.findIndex((p) => p.id === featuredPlanId)
      : PLANS.findIndex((p) => p.featured);
  const [mobilePlan, setMobilePlan] = useState(featuredIdx);
  const [isMobile, setIsMobile] = useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div className="plans-compare">
      <div className="plans-compare-head">
        <h3><Trans>Compare every subscription</Trans></h3>
        <span className="hint"><Trans>All limits are per workspace.</Trans></span>
      </div>

      {isMobile ? (
        <>
          <div className="plans-seg plans-compare-tabs" role="tablist" aria-label={_(msg`Select plan to compare`)}>
            {PLANS.map((p, i) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={i === mobilePlan}
                className={[i === mobilePlan ? "on" : "", p.featured ? "featured-plan" : ""].filter(Boolean).join(" ")}
                onClick={() => setMobilePlan(i)}
              >
                {trPlan(i18n, p.name)}
              </button>
            ))}
          </div>
          <div className="compare-mobile-list">
            {FEATURE_GROUPS.map((group) => (
              <React.Fragment key={group.name}>
                <div className="compare-mobile-group">{trPlan(i18n, group.name)}</div>
                {group.rows.map((row) => {
                  const allCells = "billing" in row ? row.billing[cycle] : row.values;
                  return (
                    <div className="compare-mobile-row" key={row.label}>
                      <div className="compare-mobile-label">{trPlan(i18n, row.label)}</div>
                      {row.hint && <div className="compare-mobile-hint">{trPlan(i18n, row.hint)}</div>}
                      <div className="compare-mobile-value">
                        <Cell value={allCells[mobilePlan]!} />
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          {(() => {
            const plan = PLANS[mobilePlan];
            if (!plan) return null;
            const isCurrent = plan.id === currentPlan;
            const isLower = currentIdx >= 0 && PLAN_ORDER.indexOf(plan.id) < currentIdx;
            return (
              <div className="compare-mobile-cta">
                <PlanCtaButton
                  plan={plan}
                  cycle={cycle}
                  isCurrent={isCurrent}
                  isLowerThanCurrent={isLower}
                  trialUsed={trialUsed}
                  {...(onSelectPlan !== undefined ? { onSelect: onSelectPlan } : {})}
                  baseClass="compare-cta"
                />
              </div>
            );
          })()}
        </>
      ) : (
        <div className="plans-compare-scroll">
          <table className="plans-table">
            <colgroup>
              <col className="col-feat" />
              {PLANS.map((p) => <col key={p.id} />)}
            </colgroup>
            <thead className="plans-thead">
              <tr>
                <th />
                {PLANS.map((p, i) => (
                  <th key={p.id} className={["planhead", i === featuredIdx ? "featured" : ""].filter(Boolean).join(" ")}>
                    <div className="ph-name">{trPlan(i18n, p.name)}</div>
                    <div className="ph-price">
                      {p.free
                        ? _(msg`Free`)
                        : `$${p[cycle === "annual" ? "annualMonthlyPrice" : "monthlyPrice"]}/workspace/month`}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_GROUPS.map((group) => (
                <React.Fragment key={group.name}>
                  <tr className="plans-group-row">
                    <td className="group-label">{trPlan(i18n, group.name)}</td>
                    {PLANS.map((p, i) => (
                      <td key={p.id} className={i === featuredIdx ? "featured-col" : ""} />
                    ))}
                  </tr>
                  {group.rows.map((row) => {
                    const allCells = "billing" in row ? row.billing[cycle] : row.values;
                    return (
                      <tr className="row" key={row.label}>
                        <td className="feat">
                          <div className="feat-label">{trPlan(i18n, row.label)}</div>
                          {row.hint && <div className="feat-hint">{trPlan(i18n, row.hint)}</div>}
                        </td>
                        {PLANS.map((p, i) => (
                          <td key={p.id} className={["cell", i === featuredIdx ? "featured-col" : ""].filter(Boolean).join(" ")}>
                            <Cell value={allCells[i]!} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot className="plans-tfoot">
              <tr>
                <td />
                {PLANS.map((p, i) => {
                  const isCurrent = p.id === currentPlan;
                  const isLower = currentIdx >= 0 && PLAN_ORDER.indexOf(p.id) < currentIdx;
                  return (
                    <td key={p.id} className={i === featuredIdx ? "featured-col" : ""}>
                      <PlanCtaButton
                        plan={p}
                        cycle={cycle}
                        isCurrent={isCurrent}
                        isLowerThanCurrent={isLower}
                        trialUsed={trialUsed}
                        {...(onSelectPlan !== undefined ? { onSelect: onSelectPlan } : {})}
                        baseClass="compare-cta"
                      />
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function SelfHostNote() {
  const { i18n } = useLingui();
  const info = SELF_HOST_NOTE;
  return (
    <div className="plans-selfhost">
      <span className="sh-glyph">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M2.5 10h15M10 2.5v15"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <circle cx="10" cy="10" r="7.6" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </span>
      <div className="sh-copy">
        <strong>{trPlan(i18n, info.title)}</strong>
        <p>{trPlan(i18n, info.body)}</p>
      </div>
      <a className="sh-cta" href={info.cta.href} target="_blank" rel="noopener noreferrer">
        {trPlan(i18n, info.cta.label)}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M3 7h8M7.5 3.5 11 7l-3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </div>
  );
}

const PLAN_ORDER: PlanId[] = ["free", "pro", "business"];

export function PricingPlans({
  currentPlan,
  trialUsed = false,
  onSelectPlan,
  className,
  showMatrix = true,
  showSelfHost = true,
}: Props) {
  const [cycle, setCycle] = useState<BillingCycle>("annual");

  const currentIdx = currentPlan ? PLAN_ORDER.indexOf(currentPlan) : -1;
  // On the highest tier there is nothing to emphasise.
  const isHighestPlan = currentIdx === PLAN_ORDER.length - 1;
  // Next tier up gets the featured treatment; null when no current plan or on highest.
  const emphasizedPlanId: PlanId | null =
    !isHighestPlan && currentIdx >= 0 && currentIdx < PLAN_ORDER.length - 1
      ? PLAN_ORDER[currentIdx + 1]!
      : null;
  // Show the badge only when using the default emphasis or when the override
  // points at the same plan as the static featured plan (free → pro).
  const defaultFeaturedId = PLANS.find((p) => p.featured)?.id;
  const showBadge =
    !isHighestPlan &&
    (emphasizedPlanId === null || emphasizedPlanId === defaultFeaturedId);

  return (
    <div className={["plans", className].filter(Boolean).join(" ")}>
      <BillingToggle cycle={cycle} onChange={setCycle} />
      <div className="plans-cards">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            cycle={cycle}
            isCurrent={plan.id === currentPlan}
            isFeatured={
              isHighestPlan
                ? false
                : emphasizedPlanId !== null
                ? plan.id === emphasizedPlanId
                : !!plan.featured
            }
            showBadge={showBadge}
            trialUsed={trialUsed}
            isLowerThanCurrent={currentIdx >= 0 && PLAN_ORDER.indexOf(plan.id) < currentIdx}
            {...(onSelectPlan !== undefined ? { onSelect: onSelectPlan } : {})}
          />
        ))}
      </div>
      {showMatrix && (
        <ComparisonMatrix
          cycle={cycle}
          trialUsed={trialUsed}
          currentIdx={currentIdx}
          {...(currentPlan !== undefined ? { currentPlan } : {})}
          {...(onSelectPlan !== undefined ? { onSelectPlan } : {})}
          {...(isHighestPlan ? { featuredPlanId: null } : emphasizedPlanId !== undefined ? { featuredPlanId: emphasizedPlanId } : {})}
        />
      )}
      {showSelfHost && <SelfHostNote />}
    </div>
  );
}
