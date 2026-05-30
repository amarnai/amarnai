import { requireUser, getUserWorkspaceRole } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { api, type TaxonomyNode, type TaxonomyEdge } from "@/lib/api";
import { db } from "@amarnai/db";
import { TaxonomyClient } from "./TaxonomyClient";

export default async function TaxonomyPage() {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  const [role, workspaceSettings] = await Promise.all([
    getUserWorkspaceRole(workspace.id, user.id),
    db.workspace.findUnique({
      where: { id: workspace.id },
      select: { membersCanEditTaxonomy: true },
    }),
  ]);

  const isAdmin = role === "OWNER";
  const canEditTaxonomy =
    isAdmin || (workspaceSettings?.membersCanEditTaxonomy ?? true);

  let nodes: TaxonomyNode[] = [];
  let edges: TaxonomyEdge[] = [];
  let error: string | null = null;

  try {
    [nodes, edges] = await Promise.all([
      api.taxonomyNodes(workspace.id),
      api.taxonomyEdges(workspace.id),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <h1>Taxonomy</h1>
      {error && <div className="error-box">{error}</div>}
      {!error && (
        <TaxonomyClient
          workspaceId={workspace.id}
          nodes={nodes}
          edges={edges}
          readOnly={!canEditTaxonomy}
        />
      )}
    </>
  );
}
