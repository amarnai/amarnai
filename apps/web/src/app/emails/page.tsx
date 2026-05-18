import Link from "next/link";
import { api, type EmailThreadSummary } from "@/lib/api";

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function priorityClass(priority: string): string {
  if (priority === "HIGH") return "badge-high";
  if (priority === "MEDIUM") return "badge-medium";
  if (priority === "LOW") return "badge-low";
  return "badge-none";
}

export default async function EmailsPage() {
  let threads: EmailThreadSummary[] = [];
  let error: string | null = null;

  try {
    const workspaces = await api.workspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error("No workspace found");
    threads = await api.emailThreads(ws.id);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <h1>Email Threads</h1>
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
                <div className="thread-meta" style={{ flexShrink: 0 }}>
                  {thread.messageCount}{" "}
                  {thread.messageCount === 1 ? "msg" : "msgs"}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
