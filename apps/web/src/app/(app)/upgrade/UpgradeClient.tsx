"use client";

import { useState } from "react";
import { PricingPlans, type PlanId, type BillingCycle } from "@amarnai/ui";
import { WorkspaceChoiceModal } from "./WorkspaceChoiceModal";

interface Props {
  workspaceId: string;
  workspaceName: string;
  currentPlan: PlanId;
}

interface Pending {
  plan: PlanId;
  cycle: BillingCycle;
}

export function UpgradeClient({ workspaceId, workspaceName, currentPlan }: Props) {
  const [pending, setPending] = useState<Pending | null>(null);

  function handleSelectPlan(plan: PlanId, cycle: BillingCycle) {
    if (plan === "free") return;
    setPending({ plan, cycle });
  }

  return (
    <>
      <PricingPlans currentPlan={currentPlan} onSelectPlan={handleSelectPlan} />

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
