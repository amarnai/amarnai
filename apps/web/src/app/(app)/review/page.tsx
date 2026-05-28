import { requireUser, getOrCreateDefaultWorkspace } from "@/lib/session";
import { api, type ReviewItem } from "@/lib/api";
import { RetryButton } from "./RetryButton";

// priorityClass — post-MVP, requires LLM triage
// function priorityClass(priority: string | null): string { ... }

export default async function ReviewPage() {
  const user = await requireUser();
  const workspace = await getOrCreateDefaultWorkspace(user.id);
  const workspaceId = workspace.id;

  let items: ReviewItem[] = [];
  let error: string | null = null;

  try {
    items = await api.reviewItems(workspaceId);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <h1>Review Queue</h1>
      {error && <div className="error-box">{error}</div>}
      {!error && (
        <p style={{ color: "var(--color-muted)", marginBottom: "20px", fontSize: 13 }}>
          {items.length} open item{items.length !== 1 ? "s" : ""}
        </p>
      )}

      {items.length === 0 && !error ? (
        <p className="empty">No items to review</p>
      ) : (
        items.map((item) => (
          <div key={item.id} className="review-card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <a
                  href={`/emails/${item.id}`}
                  className="review-title review-title-link"
                >
                  {item.subject ?? "(no subject)"}
                </a>
                {item.latestMessage && (
                  <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
                    From:{" "}
                    {item.latestMessage.senderName ?? item.latestMessage.senderEmail}
                  </div>
                )}
                {item.classification?.explanation && (
                  <p className="review-reason">{item.classification.explanation}</p>
                )}
              </div>

              {item.classification && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    alignItems: "flex-end",
                    flexShrink: 0,
                  }}
                >
                  <span className="badge">
                    {item.classification.finalNode?.name ?? "—"}
                  </span>
                  {/* priority badge — post-MVP, requires LLM triage */}
                  {/* {item.classification.priority && (
                    <span className={`badge ${priorityClass(item.classification.priority)}`}>
                      {item.classification.priority}
                    </span>
                  )} */}
                  <span className="badge">
                    {Math.round(item.classification.confidence * 100)}% confidence
                  </span>
                  {/* urgency badge — post-MVP, requires LLM triage */}
                  {/* {item.classification.urgency && (
                    <span className="badge">{item.classification.urgency}</span>
                  )} */}
                </div>
              )}
            </div>

            {item.latestMessage?.snippet && (
              <p
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  color: "var(--color-text-secondary)",
                  borderTop: "1px solid var(--color-border-light)",
                  paddingTop: 10,
                }}
              >
                {item.latestMessage.snippet}
              </p>
            )}

            {item.tags.length > 0 && (
              <div className="inline-tags">
                {item.tags.map((et) => (
                  <span
                    key={et.id}
                    className="tag-chip"
                    style={
                      et.tag.color
                        ? { background: `${et.tag.color}28`, color: et.tag.color }
                        : {}
                    }
                  >
                    {et.tag.name}
                  </span>
                ))}
              </div>
            )}

            <RetryButton workspaceId={workspaceId} threadId={item.id} />
          </div>
        ))
      )}
    </>
  );
}
