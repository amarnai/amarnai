import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { db } from "@amarnai/db";
import { UpgradeClient } from "./UpgradeClient";
import type { PlanId } from "@amarnai/ui";

export const metadata = { title: "Upgrade — Amarnai" };

const planIdMap: Record<string, PlanId> = {
  FREE: "free",
  PRO: "pro",
  BUSINESS: "business",
};

export default async function UpgradePage() {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);
  const currentPlan = planIdMap[workspace.plan] ?? "free";

  const billing = await db.workspace.findUnique({
    where: { id: workspace.id },
    select: { trialUsed: true },
  });

  return (
    <div className="upgrade-page">
      <h1>Choose a plan</h1>
      <p className="upgrade-page-intro">
        Start for free and upgrade as your needs grow.
      </p>
      <UpgradeClient
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        currentPlan={currentPlan}
        trialUsed={billing?.trialUsed ?? false}
      />
    </div>
  );
}
