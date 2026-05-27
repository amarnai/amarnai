import Link from "next/link";
import { Suspense } from "react";
import { requireUser, getOrCreateDefaultWorkspace } from "@/lib/session";
import { api, type EmailThreadSummary, type SyncStatus, type TaxonomyNode } from "@/lib/api";
import { ClassifyingRefresher } from "@/components/ClassifyingRefresher";
import { ThreadFilters, type FilterCounts } from "./ThreadFilters";

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function BackfillBanner({ syncStatus }: { syncStatus: SyncStatus }) {
  if (!syncStatus) return null;

  const { backfillStatus, backfillSkipped } = syncStatus;

  type Variant = "pending" | "running" | "warning" | "error";
  let statusLine: React.ReactNode = null;
  let variant: Variant = "pending";

  if (backfillStatus === "PENDING") {
    statusLine = "Your inbox history will be sorted automatically after the first sync.";
  } else if (backfillStatus === "RUNNING") {
    statusLine = "⏳ Sorting your inbox history — this may take a minute…";
    variant = "running";
  } else if (backfillStatus === "ERROR") {
    statusLine = "⚠ Inbox backfill failed — historical threads may not be sorted yet.";
    variant = "error";
  } else if (backfillStatus === "DONE" && backfillSkipped > 0) {
    statusLine = (
      <>
        ℹ {backfillSkipped.toLocaleString()} thread
        {backfillSkipped === 1 ? "" : "s"} from the last 90 days{" "}
        {backfillSkipped === 1 ? "was" : "were"} not sorted (inbox cap reached).
      </>
    );
    variant = "warning";
  }

  if (!statusLine) return null;

  return (
    <div className={`backfill-banner backfill-banner-${variant}`}>
      {statusLine}
    </div>
  );
}

function priorityClass(priority: string): string {
  if (priority === "HIGH") return "badge-high";
  if (priority === "MEDIUM") return "badge-medium";
  if (priority === "LOW") return "badge-low";
  return "badge-none";
}

function computeFilterCounts(threads: EmailThreadSummary[]): FilterCounts {
  return threads.reduce(
    (acc, t) => {
      acc.total++;
      if (t.triageStatus === "SORTED") acc.SORTED++;
      else if (t.triageStatus === "PENDING") acc.PENDING++;
      else if (t.triageStatus === "NEEDS_REVIEW") acc.NEEDS_REVIEW++;
      return acc;
    },
    { total: 0, PENDING: 0, NEEDS_REVIEW: 0, SORTED: 0 }
  );
}

type PageProps = {
  searchParams: Promise<{ nodeId?: string; status?: string }>;
};

export default async function EmailsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const workspace = await getOrCreateDefaultWorkspace(user.id);

  const { nodeId, status } = await searchParams;
  const filters = {
    ...(nodeId ? { nodeId } : {}),
    ...(status ? { status } : {}),
  };
  const hasFilters = Object.keys(filters).length > 0;

  let displayThreads: EmailThreadSummary[] = [];
  let syncStatus: SyncStatus = null;
  let nodes: TaxonomyNode[] = [];
  let counts: FilterCounts = { total: 0, PENDING: 0, NEEDS_REVIEW: 0, SORTED: 0 };
  let error: string | null = null;

  try {
    // Always fetch unfiltered threads so pill counts reflect the full inbox.
    // When a filter is active, also fetch the filtered set for display — both
    // calls run in parallel so there's no sequential cost.
    const [allThreads, filteredThreads, syncResult, nodesResult] = await Promise.all([
      api.emailThreads(workspace.id),
      hasFilters ? api.emailThreads(workspace.id, filters) : Promise.resolve(null),
      api.syncStatus(workspace.id),
      api.taxonomyNodes(workspace.id),
    ]);

    counts = computeFilterCounts(allThreads);
    displayThreads = filteredThreads ?? allThreads;
    syncStatus = syncResult;
    nodes = nodesResult;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const anyClassifying = displayThreads.some((t) => t.isClassifying);

  return (
    <>
      <ClassifyingRefresher active={anyClassifying} />
      <h1>Email Threads</h1>
      <BackfillBanner syncStatus={syncStatus} />
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
                        <span
                          className={`badge ${priorityClass(
                            thread.latestClassification.priority
                          )}`}
                          style={{ fontSize: 10 }}
                        >
                          {thread.latestClassification.priority}
                        </span>
                        {" "}
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
        </div>
      )}
    </>
  );
}
