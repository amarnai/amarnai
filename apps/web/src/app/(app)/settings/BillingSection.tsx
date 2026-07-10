"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

interface Props {
  plan: string;
  billingCycle: string | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  paymentFailed: boolean;
  hasSubscription: boolean;
  isAdmin: boolean;
  cancelled?: boolean;
  membersToRemoveOnCancel: Array<{ name: string | null; email: string }>;
  draftQuota?: { used: number; limit: number; resetsAt: string } | null;
  threadSortQuota?: { used: number; limit: number; resetsAt: string } | null;
  collaboratorCount?: number;
  collaboratorLimit?: number;
}

const planLabels: Record<string, MessageDescriptor> = {
  FREE: msg`Apprentice`,
  PRO: msg`Scribe`,
  BUSINESS: msg`Pharaoh`,
};

const cycleLabels: Record<string, MessageDescriptor> = {
  MONTHLY: msg`Monthly`,
  ANNUAL: msg`Annual`,
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
  cancelled,
  membersToRemoveOnCancel,
  draftQuota,
  threadSortQuota,
  collaboratorCount,
  collaboratorLimit,
}: Props) {
  const { _ } = useLingui();
  const router = useRouter();
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelStep, setCancelStep] = useState<"idle" | "confirming" | "loading">("idle");
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function openBillingPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/create-portal-session", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setPortalLoading(false);
    }
  }

  async function confirmCancel() {
    setCancelStep("loading");
    setCancelError(null);
    try {
      const res = await fetch("/api/billing/cancel-subscription", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCancelError(data.error ?? _(msg`Something went wrong. Please try again.`));
        setCancelStep("confirming");
        return;
      }
      router.push("/settings?cancelled=true");
    } catch {
      setCancelError(_(msg`Something went wrong. Please try again.`));
      setCancelStep("confirming");
    }
  }

  const now = new Date();
  const isTrialing = trialEndsAt !== null && trialEndsAt > now;
  const cycleLabel = billingCycle && cycleLabels[billingCycle] ? _(cycleLabels[billingCycle]) : null;
  const planLabel = planLabels[plan] ? _(planLabels[plan]) : plan;
  const canCancel = isAdmin && hasSubscription && !cancelAtPeriodEnd;

  return (
    <section className="settings-section">
      <h2><Trans>Subscription</Trans></h2>

      {cancelled && !cancelAtPeriodEnd && plan === "FREE" && (
        <div className="billing-alert billing-alert--info">
          <span><Trans>Your subscription has been cancelled and your workspace has been downgraded to the free tier.</Trans></span>
        </div>
      )}

      {cancelled && cancelAtPeriodEnd && currentPeriodEnd && (
        <div className="billing-alert billing-alert--info">
          <span>
            <Trans>
              Subscription cancelled. {planLabel} access continues until{" "}
              <strong suppressHydrationWarning>{currentPeriodEnd.toLocaleDateString()}</strong>.
            </Trans>
          </span>
          {hasSubscription && isAdmin && (
            <button
              type="button"
              className="billing-alert-action"
              onClick={openBillingPortal}
              disabled={portalLoading}
            >
              {portalLoading ? <Trans>Loading…</Trans> : <Trans>Reactivate</Trans>}
            </button>
          )}
        </div>
      )}

      {paymentFailed && (
        <div className="billing-alert billing-alert--error">
          <span><Trans>Payment failed. Please update your payment method to avoid losing access.</Trans></span>
          {hasSubscription && isAdmin && (
            <button
              type="button"
              className="billing-alert-action"
              onClick={openBillingPortal}
              disabled={portalLoading}
            >
              {portalLoading ? <Trans>Loading…</Trans> : <Trans>Update payment method</Trans>}
            </button>
          )}
        </div>
      )}

      {cancelAtPeriodEnd && currentPeriodEnd && !paymentFailed && (
        <div className="billing-alert billing-alert--warn">
          <span>
            <Trans>
              Subscription will not renew. {planLabel} access ends on{" "}
              <strong suppressHydrationWarning>{currentPeriodEnd.toLocaleDateString()}</strong>.
            </Trans>
          </span>
          {hasSubscription && isAdmin && (
            <button
              type="button"
              className="billing-alert-action"
              onClick={openBillingPortal}
              disabled={portalLoading}
            >
              {portalLoading ? <Trans>Loading…</Trans> : <Trans>Renew</Trans>}
            </button>
          )}
        </div>
      )}

      <div className="plan-current-row">
        <div className="plan-current-info">
          <span className="plan-current-label"><Trans>Current subscription</Trans></span>
          <div className="plan-current-name">
            {planLabel}
            {cycleLabel && <span className="plan-cycle-badge">{cycleLabel}</span>}
          </div>
        </div>

        {isAdmin && plan !== "BUSINESS" && !cancelAtPeriodEnd && (
          <Link href="/upgrade" className="btn-upgrade">
            <Trans>Upgrade</Trans> <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>

      <hr className="billing-usage-divider" />

      <div className="billing-usage-block">
        {draftQuota != null && (
          <p className="billing-note billing-usage-row">
            <span><Trans>AI drafts</Trans></span>
            <span className={draftQuota.used >= draftQuota.limit ? "billing-usage--exhausted" : undefined}>
              <Trans>
                {Math.max(0, draftQuota.limit - draftQuota.used)} / {draftQuota.limit} left · resets{" "}
                {new Date(draftQuota.resetsAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}
              </Trans>
            </span>
          </p>
        )}
        {threadSortQuota != null && (
          <p className="billing-note billing-usage-row">
            <span><Trans>Threads sorted</Trans></span>
            <span className={threadSortQuota.used >= threadSortQuota.limit ? "billing-usage--exhausted" : undefined}>
              <Trans>
                {threadSortQuota.used} / {threadSortQuota.limit} · resets{" "}
                {new Date(threadSortQuota.resetsAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}
              </Trans>
            </span>
          </p>
        )}
        {collaboratorCount != null && collaboratorLimit != null && (
          <p className="billing-note billing-usage-row">
            <span><Trans>Collaborators</Trans></span>
            {collaboratorLimit === 0 ? (
              <span><Trans>Not included · <Link href="/upgrade">upgrade to add</Link></Trans></span>
            ) : (
              <span className={collaboratorCount >= collaboratorLimit ? "billing-usage--exhausted" : undefined}>
                <Trans>{collaboratorCount} / {collaboratorLimit} added</Trans>
              </span>
            )}
          </p>
        )}
      </div>

      {isTrialing && trialEndsAt && (
        <p className="billing-note">
          <Trans>
            Free trial until{" "}
            <strong suppressHydrationWarning>{trialEndsAt.toLocaleDateString()}</strong>. You
            won&apos;t be charged before then.
          </Trans>
        </p>
      )}

      {!isTrialing && currentPeriodEnd && !cancelAtPeriodEnd && (
        <p className="billing-note">
          {billingCycle === "ANNUAL" ? (
            <Trans>
              Renews annually on{" "}
              <strong suppressHydrationWarning>{currentPeriodEnd.toLocaleDateString()}</strong>.
            </Trans>
          ) : (
            <Trans>
              Renews monthly on{" "}
              <strong suppressHydrationWarning>{currentPeriodEnd.toLocaleDateString()}</strong>.
            </Trans>
          )}
        </p>
      )}

      {canCancel && cancelStep === "idle" && (
        <button
          type="button"
          className="billing-cancel-link"
          onClick={() => setCancelStep("confirming")}
        >
          <Trans>Cancel subscription</Trans>
        </button>
      )}

      {canCancel && cancelStep !== "idle" && (
        <div className="billing-cancel-confirm">
          <p className="billing-cancel-confirm__message" suppressHydrationWarning>
            {isTrialing ? (
              <Trans>Your free trial will end immediately and your workspace will be downgraded to the free tier.</Trans>
            ) : currentPeriodEnd ? (
              <Trans>Your subscription will cancel at the end of the current billing period on {currentPeriodEnd.toLocaleDateString()}.</Trans>
            ) : (
              <Trans>Your subscription will cancel at the end of the current billing period.</Trans>
            )}
          </p>
          {membersToRemoveOnCancel.length > 0 && (
            <div className="billing-cancel-members-warning">
              <strong suppressHydrationWarning>
                {isTrialing ? (
                  <Trans>These collaborators will immediately lose access:</Trans>
                ) : currentPeriodEnd ? (
                  <Trans>These collaborators will lose access on {currentPeriodEnd.toLocaleDateString()}:</Trans>
                ) : (
                  <Trans>These collaborators will lose access at the end of the billing period:</Trans>
                )}
              </strong>
              <ul>
                {membersToRemoveOnCancel.map((m) => (
                  <li key={m.email}>{m.name ? `${m.name} (${m.email})` : m.email}</li>
                ))}
              </ul>
            </div>
          )}
          {cancelError && (
            <p className="billing-cancel-confirm__error">{cancelError}</p>
          )}
          <div className="billing-cancel-confirm__actions">
            <button
              type="button"
              className="btn-danger"
              onClick={confirmCancel}
              disabled={cancelStep === "loading"}
            >
              {cancelStep === "loading" ? <Trans>Cancelling…</Trans> : <Trans>Confirm cancellation</Trans>}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setCancelStep("idle"); setCancelError(null); }}
              disabled={cancelStep === "loading"}
            >
              <Trans>Keep subscription</Trans>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
