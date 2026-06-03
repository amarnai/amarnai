import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { api } from "@/lib/api";
import { ConnectGmailCta } from "@/components/ConnectGmailCta";
import { ClassifyingRefresher } from "@/components/ClassifyingRefresher";
import { EmailsClient } from "./EmailsClient";
import { mapFolders, mapThreads } from "./queries";
import type { ActiveSelection } from "@amarnai/ui/emails";
import { QUEUES } from "@amarnai/ui/emails";

type PageProps = {
  searchParams: Promise<{ q?: string; f?: string; t?: string }>;
};

export default async function EmailsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  const { q, f, t } = await searchParams;

  let gmailConnected = false;
  let error: string | null = null;

  const [connection, threadsResult, syncStatus, nodes, edges] =
    await Promise.allSettled([
      api.gmailConnection(workspace.id),
      api.emailThreads(workspace.id),
      api.syncStatus(workspace.id),
      api.taxonomyNodes(workspace.id),
      api.taxonomyEdges(workspace.id),
    ]);

  if (connection.status === "fulfilled") {
    gmailConnected = connection.value !== null;
  }

  if (!gmailConnected) {
    return (
      <div style={{ padding: "40px 32px" }}>
        <h1>Emails</h1>
        <ConnectGmailCta workspaceId={workspace.id} />
      </div>
    );
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

  const anyClassifying = rawThreads.some((t) => t.isClassifying);

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
      {anyClassifying && <ClassifyingRefresher active />}
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
      />
    </>
  );
}
