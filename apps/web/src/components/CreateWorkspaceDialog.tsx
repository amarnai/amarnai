"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { PLANS, type PlanId, type BillingCycle } from "@amarnai/ui";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { createWorkspaceAction } from "@/actions/workspace";

interface Props {
  hasFreeWorkspace: boolean;
  onClose: () => void;
}

export function CreateWorkspaceDialog({ hasFreeWorkspace, onClose }: Props) {
  const router = useRouter();
  const { _ } = useLingui();
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(
    hasFreeWorkspace ? "pro" : "free"
  );
  const [workspaceName, setWorkspaceName] = useState("");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const availablePlans = PLANS.filter((p) => !hasFreeWorkspace || p.id !== "free");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === backdropRef.current) onClose();
  }

  function priceLabel(planId: PlanId): string {
    const plan = PLANS.find((p) => p.id === planId)!;
    if (plan.free) return _(msg`Free`);
    const price = cycle === "annual" ? plan.annualMonthlyPrice : plan.monthlyPrice;
    return _(msg`$${price}/mo`);
  }

  async function handleSubmit() {
    const name = workspaceName.trim();
    if (!name) {
      setError(_(msg`Workspace name cannot be empty`));
      return;
    }
    setPending(true);
    setError(null);

    if (selectedPlan === "free") {
      const result = await createWorkspaceAction(name);
      if (result?.error) {
        setError(result.error);
        setPending(false);
        return;
      }
      onClose();
      router.push("/emails");
    } else {
      try {
        const res = await fetch("/api/billing/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            plan: selectedPlan,
            cycle,
            newWorkspaceName: name,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? _(msg`Something went wrong. Please try again.`));
          setPending(false);
          return;
        }
        window.location.href = data.url;
      } catch {
        setError(_(msg`Something went wrong. Please try again.`));
        setPending(false);
      }
    }
  }

  const ctaLabel = pending
    ? selectedPlan === "free"
      ? _(msg`Creating…`)
      : _(msg`Redirecting…`)
    : selectedPlan === "free"
      ? _(msg`Create workspace`)
      : _(msg`Continue to checkout`);

  return (
    <div ref={backdropRef} className="modal-backdrop" onClick={handleBackdropClick}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-ws-title"
        className="modal"
      >
        <div className="modal-header">
          <h2 id="create-ws-title" className="modal-title">
            <Trans>Create a workspace</Trans>
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label={_(msg`Close`)}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="new-ws-dialog-mascot">
            <div style={{ width: 220, height: 160, overflow: "hidden" }}>
              <Image
                src="/aziru-workspace.png"
                alt={_(msg`King Aziru`)}
                width={220}
                height={288}
                priority
                style={{ width: 220, height: "auto" }}
              />
            </div>
          </div>

          <div className="new-ws-plan-cards">
            {availablePlans.map((plan) => {
              const isSelected = selectedPlan === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  className={`option-card new-ws-plan-card${isSelected ? " option-card--selected" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedPlan(plan.id)}
                >
                  <span className="option-card-radio">
                    {isSelected && <span className="option-card-radio-dot" />}
                  </span>
                  <span className="option-card-text">
                    <span className="option-card-label">{plan.name}</span>
                    <span className="new-ws-plan-card-price">
                      {priceLabel(plan.id)}
                    </span>
                    <span className="option-card-desc">{plan.tagline}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <input
            className="ws-create-input"
            type="text"
            placeholder={_(msg`Workspace name`)}
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            maxLength={100}
            autoFocus
          />

          {selectedPlan !== "free" && (
            <div className="plans-seg" role="tablist" aria-label={_(msg`Billing cycle`)}>
              <button
                type="button"
                role="tab"
                aria-selected={cycle === "monthly"}
                className={cycle === "monthly" ? "on" : ""}
                onClick={() => setCycle("monthly")}
              >
                <Trans>Monthly</Trans>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={cycle === "annual"}
                className={cycle === "annual" ? "on" : ""}
                onClick={() => setCycle("annual")}
              >
                <Trans>Annual · Save 20%</Trans>
              </button>
            </div>
          )}

          {error && <p className="ws-choice-error">{error}</p>}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={pending}
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={pending}
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
