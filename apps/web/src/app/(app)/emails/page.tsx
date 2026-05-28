import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import {
  api,
  type EmailThreadSummary,
  type SyncStatus,
  type TaxonomyNode,
  type FilterCounts,
} from "@/lib/api";
import { ClassifyingRefresher } from "@/components/ClassifyingRefresher";
import { ConnectGmailCta } from "@/components/ConnectGmailCta";
import { ThreadFilters } from "./ThreadFilters";
import { SortingQueueControl } from "./SortingQueueControl";
import { StartSortingControl } from "./StartSortingControl";

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const MIN_NODES_TO_SORT = 4; // sorting requires more than 3 nodes

function BackfillBanner({
  syncStatus,
  nodeCount,
  workspaceId,
}: {
  syncStatus: SyncStatus;
  nodeCount: number;
  workspaceId: string;
}) {
  if (!syncStatus) return null;

  const { backfillStatus, backfillSkipped } = syncStatus;

  type Variant = "pending" | "running" | "warning" | "error";
  type BannerContent = { line: React.ReactNode; variant: Variant };

  let banner: BannerContent | null = null;

  if (backfillStatus === "PENDING") {
    if (nodeCount < MIN_NODES_TO_SORT) {
      banner = {
        line: (
          <>
            Your inbox cannot be sorted yet — add more than 3 taxonomy nodes first.{" "}
            <Link href="/taxonomy" style={{ textDecoration: "underline" }}>
              Go to Taxonomy →
            </Link>
          </>
        ),
        variant: "pending",
      };
    } else {
      banner = {
        line: (
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            Your inbox history is ready to sort.
            <StartSortingControl workspaceId={workspaceId} />
          </span>
        ),
        variant: "pending",
      };
    }
  } else if (backfillStatus === "RUNNING") {
    banner = {
      line: "⏳ Sorting your inbox history — this may take a minute…",
      variant: "running",
    };
  } else if (backfillStatus === "ERROR") {
    banner = {
      line: (
        <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          ⚠ Inbox sort failed — historical threads may not be sorted yet.
          {nodeCount >= MIN_NODES_TO_SORT && <StartSortingControl workspaceId={workspaceId} />}
        </span>
      ),
      variant: "error",
    };
  } else if (backfillStatus === "DONE" && backfillSkipped > 0) {
    banner = {
      line: (
        <>
          ℹ {backfillSkipped.toLocaleString()} thread
          {backfillSkipped === 1 ? "" : "s"} from the last 90 days{" "}
          {backfillSkipped === 1 ? "was" : "were"} not sorted (inbox cap reached).
        </>
      ),
      variant: "warning",
    };
  }

  if (!banner) return null;

  return (
    <div className={`backfill-banner backfill-banner-${banner.variant}`}>
      {banner.line}
    </div>
  );
}

// priorityClass — post-MVP, requires LLM triage
// function priorityClass(priority: string): string { ... }

function buildNextUrl(
  nodeId: string | undefined,
  status: string | undefined,
  nextCursor: string
): string {
  const params = new URLSearchParams();
  if (nodeId)  params.set("nodeId",  nodeId);
  if (status)  params.set("status",  status);
  params.set("cursor", nextCursor);
  return `/emails?${params.toString()}`;
}

type PageProps = {
  searchParams: Promise<{ nodeId?: string; status?: string; cursor?: string }>;
};

export default async function EmailsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  const { nodeId, status, cursor } = await searchParams;
  const filters = {
    ...(nodeId  ? { nodeId }  : {}),
    ...(status  ? { status }  : {}),
    ...(cursor  ? { cursor }  : {}),
  };

  let gmailConnected = false;
  let displayThreads: EmailThreadSummary[] = [];
  let nextCursor: string | null = null;
  let syncStatus: SyncStatus = null;
  let nodes: TaxonomyNode[] = [];
  let counts: FilterCounts = { total: 0, PENDING: 0, NEEDS_REVIEW: 0, SORTED: 0 };
  let error: string | null = null;

  try {
    const [connection, result, syncResult, nodesResult] = await Promise.all([
      api.gmailConnection(workspace.id),
      api.emailThreads(workspace.id, filters),
      api.syncStatus(workspace.id),
      api.taxonomyNodes(workspace.id),
    ]);
    gmailConnected = connection !== null;

    displayThreads = result.threads  ?? [];
    nextCursor     = result.nextCursor ?? null;
    counts         = result.counts   ?? { total: 0, PENDING: 0, NEEDS_REVIEW: 0, SORTED: 0 };
    syncStatus     = syncResult;
    nodes          = nodesResult;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const anyClassifying = displayThreads.some((t) => t.isClassifying);
  const hasFilters = !!(nodeId || status);

  const sortingPaused = syncStatus?.sortingPaused ?? false;

  if (!gmailConnected) {
    return (
      <>
        <h1>Email Threads</h1>
        <ConnectGmailCta workspaceId={workspace.id} />
      </>
    );
  }

  return (
    <>
      <ClassifyingRefresher active={anyClassifying} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ marginBottom: 0 }}>Email Threads</h1>
        {syncStatus !== null && (
          <SortingQueueControl workspaceId={workspace.id} sortingPaused={sortingPaused} />
        )}
      </div>
      {sortingPaused && (
        <div className="backfill-banner backfill-banner-warning">
          Sorting is paused — new emails will not be sorted automatically. Resume to continue.
        </div>
      )}
      <BackfillBanner syncStatus={syncStatus} nodeCount={nodes.length} workspaceId={workspace.id} />
      {error && <div className="error-box">{error}</div>}

      {/* ThreadFilters uses useSearchParams, so it must be wrapped in Suspense. */}
      <Suspense fallback={null}>
        <ThreadFilters nodes={nodes} counts={counts} />
      </Suspense>

      {displayThreads.length === 0 && !error ? (
        <p className="empty">
          {hasFilters ? "No threads match the selected filter." : "No threads"}
        </p>
      ) : (
        <>
          <div className="card">
            {displayThreads.map((thread) => {
              const latest = thread.messages[0];
              return (
                <Link
                  key={thread.id}
                  href={`/emails/${thread.id}`}
                  className="thread-row"
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="thread-subject">
                      {thread.subject ?? "(no subject)"}
                    </div>
                    <div className="thread-meta">
                      {latest?.senderName ?? latest?.senderEmail ?? "Unknown"} ·{" "}
                      {fmt(thread.latestMessageAt)}
                      {thread.latestClassification && (
                        <>
                          {" · "}
                          {/* priority badge — post-MVP, requires LLM triage */}
                          {/* <span
                            className={`badge ${priorityClass(
                              thread.latestClassification.priority
                            )}`}
                            style={{ fontSize: 10 }}
                          >
                            {thread.latestClassification.priority}
                          </span>
                          {" "} */}
                          <span className="badge" style={{ fontSize: 10 }}>
                            {thread.latestClassification.finalNode?.name ?? "—"}
                          </span>
                        </>
                      )}
                    </div>
                    {thread.tags.length > 0 && (
                      <div className="inline-tags">
                        {thread.tags.map((et) => (
                          <span
                            key={et.id}
                            className="tag-chip"
                            style={
                              et.tag.color
                                ? {
                                    background: `${et.tag.color}28`,
                                    color: et.tag.color,
                                  }
                                : {}
                            }
                          >
                            {et.tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span className="thread-meta">
                      {thread.messageCount}{" "}
                      {thread.messageCount === 1 ? "msg" : "msgs"}
                    </span>
                    {thread.isClassifying ? (
                      <span className="classifying-badge">
                        <span className="classifying-dot" />
                        {thread.latestClassification ? "Analyzing…" : "Sorting…"}
                      </span>
                    ) : (
                      <>
                        {thread.triageStatus === "NEEDS_REVIEW" && (
                          <span className="triage-badge triage-badge-needs_review" style={{ fontSize: 10 }}>
                            ⚠ Review
                          </span>
                        )}
                        {thread.triageStatus === "PENDING" && (
                          <span className="triage-badge triage-badge-pending" style={{ fontSize: 10 }}>
                            {thread.isQueued ? "Queued" : "Pending"}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
            {nextCursor && (
              <div className="pagination">
                <Link
                  href={buildNextUrl(nodeId, status, nextCursor)}
                  className="btn-secondary"
                >
                  Next page →
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
