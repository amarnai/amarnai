import { requireUser, getUserWorkspaceRole } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { apiFor, type TaxonomyNode, type TaxonomyEdge } from "@/lib/api";
import { Trans } from "@lingui/react/macro";
import { TaxonomyClient } from "./TaxonomyClient";

export default async function TaxonomyPage() {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  const role = await getUserWorkspaceRole(workspace.id, user.id);
  const isAdmin = role === "OWNER";

  let nodes: TaxonomyNode[] = [];
  let edges: TaxonomyEdge[] = [];
  let error: string | null = null;

  try {
    [nodes, edges] = await Promise.all([
      apiFor(user.id).taxonomyNodes(workspace.id),
      apiFor(user.id).taxonomyEdges(workspace.id),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Whether a Gmail inbox is connected, so "Generate from inbox" can start the
  // OAuth flow instead of opening an empty generator. A connection record can
  // exist but be DISCONNECTED — only ACTIVE counts as connected.
  let gmailConnected = false;
  try {
    const connection = await apiFor(user.id).gmailConnection(workspace.id);
    gmailConnected = connection?.status === "ACTIVE";
  } catch {
    gmailConnected = false;
  }

  return (
    <div className="taxonomy-shell">
      <div className="taxonomy-page-header">
        <h1><Trans>Taxonomy</Trans></h1>
        {error && <div className="error-box">{error}</div>}
      </div>
      {!error && (
        <TaxonomyClient
          workspaceId={workspace.id}
          nodes={nodes}
          edges={edges}
          readOnly={!isAdmin}
          gmailConnected={gmailConnected}
        />
      )}
    </div>
  );
}
