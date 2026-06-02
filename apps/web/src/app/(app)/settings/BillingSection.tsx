"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  cancelled?: boolean;
  membersToRemoveOnCancel: Array<{ name: string | null; email: string }>;
  draftQuota?: { used: number; limit: number; resetsAt: string } | null;
  threadSortQuota?: { used: number; limit: number; resetsAt: string } | null;
  collaboratorCount?: number;
  collaboratorLimit?: number;
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
  cancelled,
  membersToRemoveOnCancel,
  draftQuota,
  threadSortQuota,
  collaboratorCount,
  collaboratorLimit,
}: Props) {
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
        setCancelError(data.error ?? "Something went wrong. Please try again.");
        setCancelStep("confirming");
        return;
      }
      router.push("/settings?cancelled=true");
    } catch {
      setCancelError("Something went wrong. Please try again.");
      setCancelStep("confirming");
    }
  }

  const now = new Date();
  const isTrialing = trialEndsAt !== null && trialEndsAt > now;
  const cycleLabel = billingCycle ? cycleLabels[billingCycle] : null;
  const canCancel = isAdmin && hasSubscription && !cancelAtPeriodEnd;

  return (
    <section className="settings-section">
      <h2>Plan &amp; Billing</h2>

      {cancelled && !cancelAtPeriodEnd && plan === "FREE" && (
        <div className="billing-alert billing-alert--info">
          <span>Your subscription has been cancelled and your workspace has been downgraded to the free plan.</span>
        </div>
      )}

      {cancelled && cancelAtPeriodEnd && currentPeriodEnd && (
        <div className="billing-alert billing-alert--info">
          <span>
            Subscription cancelled.{" "}
            {planLabels[plan] ?? plan} access continues until{" "}
            <strong>{currentPeriodEnd.toLocaleDateString()}</strong>.
          </span>
          {hasSubscription && isAdmin && (
            <button
              type="button"
              className="billing-alert-action"
              onClick={openBillingPortal}
              disabled={portalLoading}
            >
              {portalLoading ? "Loading…" : "Reactivate"}
            </button>
          )}
        </div>
      )}

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

        {isAdmin && plan !== "BUSINESS" && !cancelAtPeriodEnd && (
          <Link href="/upgrade" className="btn-primary">
            Upgrade
          </Link>
        )}

      </div>

      <hr className="billing-usage-divider" />

      <div className="billing-usage-block">
        {draftQuota != null && (
          <p className="billing-note billing-usage-row">
            <span>AI drafts</span>
            <span className={draftQuota.used >= draftQuota.limit ? "billing-usage--exhausted" : undefined}>
              {Math.max(0, draftQuota.limit - draftQuota.used)} / {draftQuota.limit} left · resets{" "}
              {new Date(draftQuota.resetsAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}
            </span>
          </p>
        )}
        {threadSortQuota != null && (
          <p className="billing-note billing-usage-row">
            <span>Threads sorted</span>
            <span className={threadSortQuota.used >= threadSortQuota.limit ? "billing-usage--exhausted" : undefined}>
              {threadSortQuota.used} / {threadSortQuota.limit} · resets{" "}
              {new Date(threadSortQuota.resetsAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}
            </span>
          </p>
        )}
        {collaboratorCount != null && collaboratorLimit != null && (
          <p className="billing-note billing-usage-row">
            <span>Collaborators</span>
            {collaboratorLimit === 0 ? (
              <span>Not included · <Link href="/upgrade">upgrade to add</Link></span>
            ) : (
              <span className={collaboratorCount >= collaboratorLimit ? "billing-usage--exhausted" : undefined}>
                {collaboratorCount} / {collaboratorLimit} added
              </span>
            )}
          </p>
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

      {canCancel && cancelStep === "idle" && (
        <button
          type="button"
          className="billing-cancel-link"
          onClick={() => setCancelStep("confirming")}
        >
          Cancel subscription
        </button>
      )}

      {canCancel && cancelStep !== "idle" && (
        <div className="billing-cancel-confirm">
          <p className="billing-cancel-confirm__message">
            {isTrialing
              ? "Your free trial will end immediately and your workspace will be downgraded to the free plan."
              : `Your subscription will cancel at the end of the current billing period${currentPeriodEnd ? ` on ${currentPeriodEnd.toLocaleDateString()}` : ""}.`}
          </p>
          {membersToRemoveOnCancel.length > 0 && (
            <div className="billing-cancel-members-warning">
              <strong>
                {isTrialing
                  ? "These collaborators will immediately lose access:"
                  : `These collaborators will lose access on ${currentPeriodEnd?.toLocaleDateString() ?? "the end of the billing period"}:`}
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
              {cancelStep === "loading" ? "Cancelling…" : "Confirm cancellation"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setCancelStep("idle"); setCancelError(null); }}
              disabled={cancelStep === "loading"}
            >
              Keep subscription
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
