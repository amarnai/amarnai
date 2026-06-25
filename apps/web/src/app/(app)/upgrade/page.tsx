import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { db } from "@amarnai/db";
import { UpgradeClient } from "./UpgradeClient";
import type { PlanId, BillingCycle } from "@amarnai/ui";

export const metadata = { title: "Upgrade — Amarnai" };

const planIdMap: Record<string, PlanId> = {
  FREE: "free",
  PRO: "pro",
  BUSINESS: "business",
};

const VALID_PLANS: PlanId[] = ["pro", "business"];
const VALID_CYCLES: BillingCycle[] = ["monthly", "annual"];

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);
  const currentPlan = planIdMap[workspace.plan] ?? "free";

  const userBilling = await db.user.findUnique({
    where: { id: user.id },
    select: { trialUsed: true },
  });

  const params = await searchParams;
  const planParam = typeof params.plan === "string" ? params.plan as PlanId : undefined;
  const cycleParam = typeof params.cycle === "string" ? params.cycle as BillingCycle : undefined;
  const preselectedPlan = planParam && VALID_PLANS.includes(planParam) ? planParam : undefined;
  const preselectedCycle = cycleParam && VALID_CYCLES.includes(cycleParam) ? cycleParam : undefined;

  return (
    <div className="upgrade-page">
      <h1>Choose a subscription</h1>
      <p className="upgrade-page-intro">
        Start for free and upgrade as your needs grow.
      </p>
      <UpgradeClient
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        currentPlan={currentPlan}
        trialUsed={userBilling?.trialUsed ?? false}
        {...(preselectedPlan ? { preselectedPlan } : {})}
        {...(preselectedCycle ? { preselectedCycle } : {})}
      />
    </div>
  );
}
