import { api } from "@/lib/api";

async function loadDashboard() {
  const workspaces = await api.workspaces();
  const ws = workspaces[0];
  if (!ws) throw new Error("No workspace found");

  const [nodes, threads, reviews, tags] = await Promise.all([
    api.taxonomyNodes(ws.id),
    api.emailThreads(ws.id),
    api.reviewItems(ws.id),
    api.tags(ws.id),
  ]);

  return {
    workspace: ws,
    nodeCount: nodes.length,
    threadCount: threads.length,
    reviewCount: reviews.length,
    tagCount: tags.length,
  };
}

export default async function DashboardPage() {
  let data;
  try {
    data = await loadDashboard();
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
    </>
  );
}
