import Link from "next/link";
import { requireUser, getOrCreateDefaultWorkspace } from "@/lib/session";
import { api, type EmailThreadSummary, type SyncStatus } from "@/lib/api";
import { ClassifyingRefresher } from "@/components/ClassifyingRefresher";

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

type ThreadCounts = { sorted: number; pending: number; needsReview: number };

function CountsLine({ counts }: { counts: ThreadCounts }) {
  const { sorted, pending, needsReview } = counts;
  return (
    <div className="backfill-counts">
      <span>{sorted.toLocaleString()} sorted</span>
      <span className="backfill-counts-sep">·</span>
      <span>{pending.toLocaleString()} pending</span>
      <span className="backfill-counts-sep">·</span>
      <span
        style={needsReview > 0 ? { color: "var(--color-warning-text)", fontWeight: 500 } : {}}
      >
        {needsReview.toLocaleString()} need{needsReview === 1 ? "s" : ""} review
      </span>
    </div>
  );
}

function BackfillBanner({
  syncStatus,
  counts,
}: {
  syncStatus: SyncStatus;
  counts: ThreadCounts;
}) {
  if (!syncStatus) return null;

  const { backfillStatus, backfillSkipped } = syncStatus;
  const { pending, needsReview } = counts;
  const total = counts.sorted + pending + needsReview;

  // Determine the status message and visual variant for this backfill state.
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

  // If there's no status message and everything is clean, hide the banner.
  if (!statusLine && pending === 0 && needsReview === 0) return null;

  return (
    <div className={`backfill-banner backfill-banner-${variant}`}>
      {statusLine && <div>{statusLine}</div>}
      {total > 0 && <CountsLine counts={counts} />}
    </div>
  );
}

function priorityClass(priority: string): string {
  if (priority === "HIGH") return "badge-high";
  if (priority === "MEDIUM") return "badge-medium";
  if (priority === "LOW") return "badge-low";
  return "badge-none";
}

export default async function EmailsPage() {
  const user = await requireUser();
  const workspace = await getOrCreateDefaultWorkspace(user.id);

  let threads: EmailThreadSummary[] = [];
  let syncStatus: SyncStatus = null;
  let error: string | null = null;

  try {
    [threads, syncStatus] = await Promise.all([
      api.emailThreads(workspace.id),
      api.syncStatus(workspace.id),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const counts: ThreadCounts = threads.reduce(
    (acc, t) => {
      if (t.triageStatus === "SORTED") acc.sorted++;
      else if (t.triageStatus === "PENDING") acc.pending++;
      else if (t.triageStatus === "NEEDS_REVIEW") acc.needsReview++;
      return acc;
    },
    { sorted: 0, pending: 0, needsReview: 0 }
  );

  const anyClassifying = threads.some((t) => t.isClassifying);

  return (
    <>
      <ClassifyingRefresher active={anyClassifying} />
      <h1>Email Threads</h1>
      <BackfillBanner syncStatus={syncStatus} counts={counts} />
      {error && <div className="error-box">{error}</div>}

      {threads.length === 0 && !error ? (
        <p className="empty">No threads</p>
      ) : (
        <div className="card">
          {threads.map((thread) => {
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
