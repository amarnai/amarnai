import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { api } from "@/lib/api";
import FoldersSection from "./FoldersSection";

export default async function DashboardPage() {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  let data;
  try {
    const [nodes, edges, threadsResult, reviews, folderCountsResult] =
      await Promise.all([
        api.taxonomyNodes(workspace.id),
        api.taxonomyEdges(workspace.id),
        api.emailThreads(workspace.id),
        api.reviewItems(workspace.id),
        api.folderCounts(workspace.id),
      ]);

    // Convert the counts array to a Record for O(1) lookup in FoldersSection.
    const folderCounts: Record<string, number> = {};
    for (const { nodeId, count } of folderCountsResult.counts) {
      folderCounts[nodeId] = count;
    }

    data = {
      workspace,
      nodes,
      edges,
      // First-page threads — used only for the right-panel thread preview in
      // FoldersSection. Per-node counts come from folderCounts instead.
      threads: threadsResult.threads,
      nodeCount: nodes.length,
      threadCount: threadsResult.counts.total,
      reviewCount: reviews.length,
      folderCounts,
      totalClassified: folderCountsResult.total,
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
      </div>

      <div className="section-gap">
        <h2>Folders</h2>
        <FoldersSection
          nodes={data.nodes}
          edges={data.edges}
          threads={data.threads}
          folderCounts={data.folderCounts}
          totalClassified={data.totalClassified}
        />
      </div>
    </>
  );
}
