import { api, type TaxonomyNode, type TaxonomyEdge } from "@/lib/api";
import { TaxonomyClient } from "./TaxonomyClient";

export default async function TaxonomyPage() {
  let workspaceId = "";
  let nodes: TaxonomyNode[] = [];
  let edges: TaxonomyEdge[] = [];
  let error: string | null = null;

  try {
    const workspaces = await api.workspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error("No workspace found");
    workspaceId = ws.id;
    [nodes, edges] = await Promise.all([
      api.taxonomyNodes(ws.id),
      api.taxonomyEdges(ws.id),
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
          workspaceId={workspaceId}
          nodes={nodes}
          edges={edges}
        />
      )}
    </>
  );
}
