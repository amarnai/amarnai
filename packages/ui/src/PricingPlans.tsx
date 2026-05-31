"use client";

import React, { useState } from "react";
import {
  PLANS,
  FEATURE_GROUPS,
  SELF_HOST_NOTE,
  type PlanId,
  type BillingCycle,
  type CellValue,
} from "./plans.js";

interface Props {
  currentPlan?: PlanId;
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
  return (
    <span className="cell-yes" role="img" aria-label="Included">
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
  if (value === true) return <CellYes />;
  if (value === false) return <span className="cell-no" role="img" aria-label="Not included" />;
  if (typeof value === "object") {
    if ("soon" in value) return <CellSoon label={value.soon} />;
    if ("note" in value) return <span className="note">{value.note}</span>;
  }
  return <span>{value as string}</span>;
}

function BillingToggle({
  cycle,
  onChange,
}: {
  cycle: BillingCycle;
  onChange: (c: BillingCycle) => void;
}) {
  return (
    <div className="plans-billing">
      <div className="plans-seg" role="tablist" aria-label="Billing cycle">
        <button
          role="tab"
          aria-selected={cycle === "monthly"}
          className={cycle === "monthly" ? "on" : ""}
          onClick={() => onChange("monthly")}
        >
          Monthly
        </button>
        <button
          role="tab"
          aria-selected={cycle === "annual"}
          className={cycle === "annual" ? "on" : ""}
          onClick={() => onChange("annual")}
        >
          Annual
        </button>
      </div>
      <span className="plans-save">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 1.4 8.7 4.9l3.9.5-2.8 2.7.7 3.8L7 10.1 3.5 11.9l.7-3.8L1.4 5.4l3.9-.5L7 1.4Z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
        Save up to 20% annually
      </span>
    </div>
  );
}

function PlanPrice({ plan, cycle }: { plan: (typeof PLANS)[number]; cycle: BillingCycle }) {
  if (plan.free) {
    return (
      <>
        <div className="plan-price">
          <span className="amount">Free</span>
        </div>
        <div className="plan-pricenote">Free forever · self-serve</div>
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
        <span className="per">/ workspace / month</span>
      </div>
      <div className="plan-pricenote">
        {cycle === "annual" ? (
          <>
            Billed annually ·{" "}
            <span className="ann">save {pct}%</span>
          </>
        ) : (
          "Billed monthly · 14-day free trial"
        )}
      </div>
    </>
  );
}

function PlanCard({
  plan,
  cycle,
  isCurrent,
  onSelect,
}: {
  plan: (typeof PLANS)[number];
  cycle: BillingCycle;
  isCurrent: boolean;
  onSelect?: ((plan: PlanId, cycle: BillingCycle) => void) | undefined;
}) {
  const cardClass = ["plan-card", plan.featured ? "featured" : ""].filter(Boolean).join(" ");
  const ctaClass = [
    "plan-cta",
    plan.cta.kind === "primary" ? "primary" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClass}>
      {plan.badge && <span className="plan-badge">{plan.badge}</span>}
      <div className="plan-name">{plan.name}</div>
      <div className="plan-tagline">{plan.tagline}</div>
      <PlanPrice plan={plan} cycle={cycle} />
      <button
        className={ctaClass}
        disabled={isCurrent}
        onClick={() => !isCurrent && onSelect?.(plan.id, cycle)}
      >
        {isCurrent ? "Current plan" : plan.cta.label}
      </button>
      <ul className="plan-hl">
        {plan.highlights.map((h) => (
          <li key={h}>
            <TickIcon />
            {h}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonMatrix({ cycle }: { cycle: BillingCycle }) {
  const featuredIdx = PLANS.findIndex((p) => p.featured);
  const colClass = (i: number) => (i === featuredIdx ? "cell featured-col" : "cell");

  return (
    <div className="plans-compare">
      <div className="plans-compare-head">
        <h3>Compare every plan</h3>
        <span className="hint">All limits are per workspace.</span>
      </div>
      <div className="plans-compare-scroll">
        <table className="plans-table">
          <colgroup>
            <col className="col-feat" />
            {PLANS.map((p) => (
              <col key={p.id} />
            ))}
          </colgroup>
          <thead className="plans-thead">
            <tr>
              <th />
              {PLANS.map((p, i) => (
                <th
                  key={p.id}
                  className={"planhead" + (i === featuredIdx ? " featured" : "")}
                >
                  <div className="ph-name">{p.name}</div>
                  <div className="ph-price">
                    {p.free
                      ? "Free"
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
                  <td className="group-label">{group.name}</td>
                  {PLANS.map((p, i) => (
                    <td key={p.id} className={i === featuredIdx ? "featured-col" : ""} />
                  ))}
                </tr>
                {group.rows.map((row) => {
                  const cells = "billing" in row ? row.billing[cycle] : row.values;
                  return (
                    <tr className="row" key={row.label}>
                      <td className="feat">
                        <div className="feat-label">{row.label}</div>
                        {row.hint && <div className="feat-hint">{row.hint}</div>}
                      </td>
                      {cells.map((v, i) => (
                        <td key={i} className={colClass(i)}>
                          <Cell value={v} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SelfHostNote() {
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
        <strong>{info.title}</strong>
        <p>{info.body}</p>
      </div>
      <a className="sh-cta" href={info.cta.href}>
        {info.cta.label}
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

export function PricingPlans({
  currentPlan,
  onSelectPlan,
  className,
  showMatrix = true,
  showSelfHost = true,
}: Props) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

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
            onSelect={onSelectPlan}
          />
        ))}
      </div>
      {showMatrix && <ComparisonMatrix cycle={cycle} />}
      {showSelfHost && <SelfHostNote />}
    </div>
  );
}
