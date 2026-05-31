import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { UpgradeClient } from "./UpgradeClient";

export const metadata = { title: "Upgrade — Amarnai" };

export default async function UpgradePage() {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  return (
    <div className="upgrade-page">
      <h1>Choose a plan</h1>
      <p className="upgrade-page-intro">
        Start for free and upgrade as your needs grow.
      </p>
      <UpgradeClient
        workspaceId={workspace.id}
        workspaceName={workspace.name}
      />
    </div>
  );
}
