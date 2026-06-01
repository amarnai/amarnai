"use client";

import { useState } from "react";
import Link from "next/link";

interface Props {
  plan: string;
  billingCycle: string | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  paymentFailed: boolean;
  hasSubscription: boolean;
  isAdmin: boolean;
}

const planLabels: Record<string, string> = {
  FREE: "Personal",
  PRO: "Pro",
  BUSINESS: "Business",
};

const cycleLabels: Record<string, string> = {
  MONTHLY: "Monthly",
  ANNUAL: "Annual",
};

export function BillingSection({
  plan,
  billingCycle,
  currentPeriodEnd,
  trialEndsAt,
  cancelAtPeriodEnd,
  paymentFailed,
  hasSubscription,
  isAdmin,
}: Props) {
  const [portalLoading, setPortalLoading] = useState(false);

  async function openBillingPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/create-portal-session", {
        method: "POST",
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setPortalLoading(false);
    }
  }

  const now = new Date();
  const isTrialing = trialEndsAt !== null && trialEndsAt > now;
  const cycleLabel = billingCycle ? cycleLabels[billingCycle] : null;

  return (
    <section className="settings-section">
      <h2>Plan &amp; Billing</h2>

      {paymentFailed && (
        <div className="billing-alert billing-alert--error">
          <span>Payment failed. Please update your payment method to avoid losing access.</span>
          {hasSubscription && isAdmin && (
            <button
              type="button"
              className="billing-alert-action"
              onClick={openBillingPortal}
              disabled={portalLoading}
            >
              {portalLoading ? "Loading…" : "Update payment method"}
            </button>
          )}
        </div>
      )}

      {cancelAtPeriodEnd && currentPeriodEnd && !paymentFailed && (
        <div className="billing-alert billing-alert--warn">
          <span>
            Subscription will not renew.{" "}
            {planLabels[plan] ?? plan} access ends on{" "}
            <strong>{currentPeriodEnd.toLocaleDateString()}</strong>.
          </span>
          {hasSubscription && isAdmin && (
            <button
              type="button"
              className="billing-alert-action"
              onClick={openBillingPortal}
              disabled={portalLoading}
            >
              {portalLoading ? "Loading…" : "Renew"}
            </button>
          )}
        </div>
      )}

      <div className="plan-current-row">
        <span className="plan-current-badge">{planLabels[plan] ?? plan}</span>
        {cycleLabel && (
          <span className="plan-cycle-badge">{cycleLabel}</span>
        )}

        {isAdmin && plan === "FREE" && (
          <Link href="/upgrade" className="btn-primary">
            Upgrade
          </Link>
        )}

        {isAdmin && hasSubscription && !cancelAtPeriodEnd && (
          <button
            type="button"
            className="btn-ghost"
            onClick={openBillingPortal}
            disabled={portalLoading}
          >
            {portalLoading ? "Loading…" : "Manage billing"}
          </button>
        )}
      </div>

      {isTrialing && trialEndsAt && (
        <p className="billing-note">
          Free trial until{" "}
          <strong>{trialEndsAt.toLocaleDateString()}</strong>. You
          won&apos;t be charged before then.
        </p>
      )}

      {!isTrialing && currentPeriodEnd && !cancelAtPeriodEnd && (
        <p className="billing-note">
          Renews {billingCycle === "ANNUAL" ? "annually" : "monthly"} on{" "}
          <strong>{currentPeriodEnd.toLocaleDateString()}</strong>.
        </p>
      )}
    </section>
  );
}
