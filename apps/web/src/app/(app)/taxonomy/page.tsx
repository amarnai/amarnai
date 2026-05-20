import { requireUser, getOrCreateDefaultWorkspace } from "@/lib/session";
import { api, type TaxonomyNode, type TaxonomyEdge } from "@/lib/api";
import { TaxonomyClient } from "./TaxonomyClient";

export default async function TaxonomyPage() {
  const user = await requireUser();
  const workspace = await getOrCreateDefaultWorkspace(user.id);

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
        />
      )}
    </>
  );
}
