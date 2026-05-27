import { requireUser, getOrCreateDefaultWorkspace } from "@/lib/session";
import { api } from "@/lib/api";
import FoldersSection from "./FoldersSection";

export default async function DashboardPage() {
  const user = await requireUser();
  const workspace = await getOrCreateDefaultWorkspace(user.id);

  let data;
  try {
    const [nodes, edges, threadsResult, reviews, tags] = await Promise.all([
      api.taxonomyNodes(workspace.id),
      api.taxonomyEdges(workspace.id),
      api.emailThreads(workspace.id),
      api.reviewItems(workspace.id),
      api.tags(workspace.id),
    ]);
    data = {
      workspace,
      nodes,
      edges,
      // First page of threads only — FoldersSection per-node counts are
      // approximate until the dashboard gets its own aggregation endpoint.
      threads: threadsResult.threads,
      nodeCount: nodes.length,
      threadCount: threadsResult.counts.total,
      reviewCount: reviews.length,
      tagCount: tags.length,
    };
  } catch (err) {
    return (
      <>
        <h1>Dashboard</h1>
        <div className="error-box">
          Could not load data — is the API running?{" "}
          {err instanceof Error ? err.message : String(err)}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>{data.workspace.name}</h1>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Taxonomy nodes</div>
          <div className="stat-value">{data.nodeCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Email threads</div>
          <div className="stat-value">{data.threadCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open reviews</div>
          <div className="stat-value">{data.reviewCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tags</div>
          <div className="stat-value">{data.tagCount}</div>
        </div>
      </div>

      <div className="section-gap">
        <h2>Folders</h2>
        <FoldersSection
          nodes={data.nodes}
          edges={data.edges}
          threads={data.threads}
        />
      </div>
    </>
  );
}
