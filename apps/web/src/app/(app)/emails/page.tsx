import Link from "next/link";
import { requireUser, getOrCreateDefaultWorkspace } from "@/lib/session";
import { api, type EmailThreadSummary, type SyncStatus } from "@/lib/api";

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

  if (backfillStatus === "RUNNING") {
    return (
      <div className="backfill-banner backfill-banner-running">
        ⏳ Sorting your inbox history — this may take a minute…
      </div>
    );
  }

  if (backfillStatus === "ERROR") {
    return (
      <div className="backfill-banner backfill-banner-error">
        ⚠ Inbox backfill failed — historical threads may not be sorted yet.
      </div>
    );
  }

  if (backfillStatus === "DONE" && backfillSkipped > 0) {
    return (
      <div className="backfill-banner backfill-banner-warning">
        ℹ {backfillSkipped.toLocaleString()} thread
        {backfillSkipped === 1 ? "" : "s"} from the last 90 days{" "}
        {backfillSkipped === 1 ? "was" : "were"} not sorted (inbox cap reached).
      </div>
    );
  }

  return null;
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

  return (
    <>
      <h1>Email Threads</h1>
      <BackfillBanner syncStatus={syncStatus} />
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
                  {thread.triageStatus === "NEEDS_REVIEW" && (
                    <span className="triage-badge triage-badge-needs_review" style={{ fontSize: 10 }}>
                      ⚠ Review
                    </span>
                  )}
                  {thread.triageStatus === "PENDING" && (
                    <span className="triage-badge triage-badge-pending" style={{ fontSize: 10 }}>
                      Pending
                    </span>
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
