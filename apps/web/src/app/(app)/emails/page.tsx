import { db } from "@amarnai/db";
import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { apiFor } from "@/lib/api";
import { initServerI18n } from "@/lib/i18n-server";
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
  await initServerI18n();

  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  const { q, f, t } = await searchParams;

  let error: string | null = null;

  // Initial fetch is scoped to the active view (queue/folder) from the URL, so
  // the server-rendered list, count, and the client view-model all start in sync.
  const initialFilters: { nodeId?: string; status?: string; important?: boolean; assigned?: boolean } =
    f
      ? { nodeId: f }
      : q === "sorted"       ? { status: "SORTED" }
      : q === "review"       ? { status: "NEEDS_REVIEW" }
      : q === "pending"      ? { status: "PENDING" }
      : q === "important"    ? { important: true }
      : q === "assigned"     ? { assigned: true }
      : q === "unrouted"     ? { status: "UNROUTED" }
      : q === "unclassified" ? { status: "UNCLASSIFIED" }
      : {};

  const userApi = apiFor(user.id);
  const [connection, threadsResult, syncStatus, nodes, edges] =
    await Promise.allSettled([
      userApi.gmailConnection(workspace.id),
      userApi.emailThreads(workspace.id, initialFilters),
      userApi.syncStatus(workspace.id),
      userApi.taxonomyNodes(workspace.id),
      userApi.taxonomyEdges(workspace.id),
    ]);

  const connectionValue =
    connection.status === "fulfilled" ? connection.value : null;

  // A connection record can exist but be DISCONNECTED (e.g. revoked or expired).
  // Only an ACTIVE connection is actually syncing this inbox.
  const gmailConnected = connectionValue?.status === "ACTIVE";

  if (!gmailConnected) {
    return (
      <ConnectGmailCta
        workspaceId={workspace.id}
        reconnect={connectionValue !== null}
      />
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

  const workspaceEmail = connectionValue ? connectionValue.gmailAddress : null;

  const rawThreads =
    threadsResult.status === "fulfilled" ? threadsResult.value.threads : [];
  const initialNextCursor =
    threadsResult.status === "fulfilled" ? threadsResult.value.nextCursor : null;
  const initialCounts =
    threadsResult.status === "fulfilled" ? threadsResult.value.counts : undefined;
  const initialFilteredTotal =
    threadsResult.status === "fulfilled" ? threadsResult.value.filteredTotal : 0;
  const rawNodes =
    nodes.status === "fulfilled" ? nodes.value : [];
  const rawEdges =
    edges.status === "fulfilled" ? edges.value : [];
  const resolvedSyncStatus =
    syncStatus.status === "fulfilled" ? syncStatus.value : null;

  const folders = mapFolders(rawNodes, rawEdges);
  const threads = mapThreads(rawThreads);

  const routableNodeCount = countRoutableNonRootNodes(rawNodes, rawEdges);
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

  // Workspace members drive the assignment picker. Fetched directly here (server
  // component) rather than via a dedicated endpoint — the member list is small
  // and already workspace-scoped.
  const memberRows = await db.workspaceMember.findMany({
    where: { workspaceId: workspace.id },
    select: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const members = memberRows.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
  }));

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
        initialNextCursor={initialNextCursor}
        initialCounts={initialCounts}
        initialFilteredTotal={initialFilteredTotal}
        initialFolders={folders}
        initialActive={initialActive}
        initialSelectedId={initialSelectedId}
        syncStatus={resolvedSyncStatus}
        workspaceEmail={workspaceEmail}
        routableNodeCount={routableNodeCount}
        unclassifiedCount={unclassifiedCount}
        members={members}
      />
    </>
  );
}
