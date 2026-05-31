"use client";

import { useState } from "react";
import { PricingPlans, type PlanId } from "@amarnai/ui";
import { WorkspaceChoiceModal } from "./WorkspaceChoiceModal";

interface Props {
  workspaceId: string;
  workspaceName: string;
}

export function UpgradeClient({ workspaceId: _workspaceId, workspaceName }: Props) {
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);

  function handleSelectPlan(plan: PlanId, _cycle: string) {
    if (plan === "free") return;
    setPendingPlan(plan);
  }

  function upgradeCurrentWorkspace() {
    // TODO: implement upgrade flow for workspace ${workspaceId} to plan ${pendingPlan}
    setPendingPlan(null);
  }

  function createPaidWorkspace() {
    // TODO: implement new paid workspace creation for plan ${pendingPlan}
    setPendingPlan(null);
  }

  return (
    <>
      <PricingPlans currentPlan="free" onSelectPlan={handleSelectPlan} />

      {pendingPlan !== null && (
        <WorkspaceChoiceModal
          workspaceName={workspaceName}
          onClose={() => setPendingPlan(null)}
          onUpgradeCurrentWorkspace={upgradeCurrentWorkspace}
          onCreatePaidWorkspace={createPaidWorkspace}
        />
      )}
    </>
  );
}
