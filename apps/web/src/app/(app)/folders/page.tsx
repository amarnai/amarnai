import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { api } from "@/lib/api";
import FolderBrowser from "./FolderBrowser";

export default async function FoldersPage() {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  let data;
  try {
    const [nodes, edges, threadsResult, folderCountsResult] = await Promise.all([
      api.taxonomyNodes(workspace.id),
      api.taxonomyEdges(workspace.id),
      api.emailThreads(workspace.id),
      api.folderCounts(workspace.id),
    ]);

    const folderCounts: Record<string, number> = {};
    for (const { nodeId, count } of folderCountsResult.counts) {
      folderCounts[nodeId] = count;
    }

    data = {
      nodes,
      edges,
      threads: threadsResult.threads,
      folderCounts,
      totalClassified: folderCountsResult.total,
    };
  } catch (err) {
    return (
      <>
        <h1>Folders</h1>
        <div className="error-box">
          Could not load data — is the API running?{" "}
          {err instanceof Error ? err.message : String(err)}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Folders</h1>
      <FolderBrowser
        nodes={data.nodes}
        edges={data.edges}
        threads={data.threads}
        folderCounts={data.folderCounts}
        totalClassified={data.totalClassified}
      />
    </>
  );
}
