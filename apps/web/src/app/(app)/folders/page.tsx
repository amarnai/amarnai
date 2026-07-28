import { requireUser, canEditTaxonomy } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { apiFor, type TaxonomyNode, type TaxonomyEdge } from "@/lib/api";
import { Trans } from "@lingui/react/macro";
import { initServerI18n } from "@/lib/i18n-server";
import { TaxonomyClient } from "./TaxonomyClient";

export default async function TaxonomyPage() {
  await initServerI18n();
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  // Matches the API's rule rather than an owner-only shortcut, so a member of a
  // workspace that allows member editing is not shown a read-only canvas the
  // server would happily have accepted writes from.
  const canEdit = await canEditTaxonomy(workspace.id, user.id);

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
        <h1><Trans>Folders</Trans></h1>
        {error && <div className="error-box">{error}</div>}
      </div>
      {!error && (
        <TaxonomyClient
          workspaceId={workspace.id}
          nodes={nodes}
          edges={edges}
          readOnly={!canEdit}
          gmailConnected={gmailConnected}
        />
      )}
    </div>
  );
}
