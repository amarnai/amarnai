import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { apiFor } from "@/lib/api";
import { ConnectGmailCta } from "@/components/ConnectGmailCta";
import { EmailsClient } from "./EmailsClient";
import { mapFolders, mapThreads } from "./queries";
import type { ActiveSelection } from "@amarnai/ui/emails";
import { QUEUES } from "@amarnai/ui/emails";
import { countRoutableNonRootNodes } from "@amarnai/shared";

type PageProps = {
  searchParams: Promise<{ q?: string; f?: string; t?: string }>;
};

export default async function EmailsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  const { q, f, t } = await searchParams;

  let gmailConnected = false;
  let error: string | null = null;

  const userApi = apiFor(user.id);
  const [connection, threadsResult, syncStatus, nodes, edges] =
    await Promise.allSettled([
      userApi.gmailConnection(workspace.id),
      userApi.emailThreads(workspace.id),
      userApi.syncStatus(workspace.id),
      userApi.taxonomyNodes(workspace.id),
      userApi.taxonomyEdges(workspace.id),
    ]);

  if (connection.status === "fulfilled") {
    gmailConnected = connection.value !== null;
  }

  if (!gmailConnected) {
    return <ConnectGmailCta workspaceId={workspace.id} />;
  }

  if (
    threadsResult.status === "rejected" ||
    nodes.status === "rejected" ||
    edges.status === "rejected"
  ) {
    error =
      threadsResult.status === "rejected"
        ? (threadsResult.reason as Error).message
        : (nodes.status === "rejected"
            ? (nodes.reason as Error).message
            : (edges as PromiseRejectedResult).reason.message);
  }

  const workspaceEmail =
    connection.status === "fulfilled" && connection.value
      ? connection.value.gmailAddress
      : null;

  const rawThreads =
    threadsResult.status === "fulfilled" ? threadsResult.value.threads : [];
  const rawNodes =
    nodes.status === "fulfilled" ? nodes.value : [];
  const rawEdges =
    edges.status === "fulfilled" ? edges.value : [];
  const resolvedSyncStatus =
    syncStatus.status === "fulfilled" ? syncStatus.value : null;

  const folders = mapFolders(rawNodes, rawEdges);
  const threads = mapThreads(rawThreads);

  const routableNodeCount = countRoutableNonRootNodes(rawNodes, rawEdges);
  const unroutedCount = rawThreads.filter((t) => t.triageStatus === "UNROUTED").length;
  const unclassifiedCount = rawThreads.filter((t) => t.triageStatus === "UNCLASSIFIED").length;

  // Resolve initial active selection from URL params
  let initialActive: ActiveSelection;
  if (f) {
    initialActive = { kind: "folder", id: f };
  } else if (q) {
    const validQueue = QUEUES.find((queue) => queue.id === q);
    initialActive = validQueue
      ? { kind: "queue", id: validQueue.id }
      : { kind: "queue", id: "all" };
  } else {
    initialActive = { kind: "queue", id: "all" };
  }

  const initialSelectedId = t ?? null;

  return (
    <>
      {error && (
        <div className="error-box" style={{ margin: "16px 24px" }}>
          {error}
        </div>
      )}
      <EmailsClient
        workspaceId={workspace.id}
        currentUserId={user.id}
        initialThreads={threads}
        initialFolders={folders}
        initialActive={initialActive}
        initialSelectedId={initialSelectedId}
        syncStatus={resolvedSyncStatus}
        workspaceEmail={workspaceEmail}
        routableNodeCount={routableNodeCount}
        unroutedCount={unroutedCount}
        unclassifiedCount={unclassifiedCount}
      />
    </>
  );
}
