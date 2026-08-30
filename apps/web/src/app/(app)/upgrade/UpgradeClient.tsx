"use client";

import { useEffect, useState } from "react";
import { PricingPlans, type PlanId, type BillingCycle } from "@aziru/ui";
import { WorkspaceChoiceModal } from "./WorkspaceChoiceModal";

interface Props {
  workspaceId: string;
  workspaceName: string;
  currentPlan: PlanId;
  trialUsed: boolean;
  preselectedPlan?: PlanId;
  preselectedCycle?: BillingCycle;
}

interface Pending {
  plan: PlanId;
  cycle: BillingCycle;
}

export function UpgradeClient({
  workspaceId,
  workspaceName,
  currentPlan,
  trialUsed,
  preselectedPlan,
  preselectedCycle,
}: Props) {
  const [pending, setPending] = useState<Pending | null>(
    preselectedPlan ? { plan: preselectedPlan, cycle: preselectedCycle ?? "monthly" } : null,
  );

  useEffect(() => {
    if (preselectedPlan && preselectedPlan !== currentPlan) {
      setPending({ plan: preselectedPlan, cycle: preselectedCycle ?? "monthly" });
    }
  }, [preselectedPlan, preselectedCycle, currentPlan]);

  function handleSelectPlan(plan: PlanId, cycle: BillingCycle) {
    if (plan === "free") return;
    setPending({ plan, cycle });
  }

  return (
    <>
      <PricingPlans currentPlan={currentPlan} trialUsed={trialUsed} onSelectPlan={handleSelectPlan} />

      {pending !== null && (
        <WorkspaceChoiceModal
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          plan={pending.plan}
          cycle={pending.cycle}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
