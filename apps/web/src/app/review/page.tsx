import { api, type ReviewItem } from "@/lib/api";

function priorityClass(priority: string): string {
  if (priority === "HIGH") return "badge-high";
  if (priority === "MEDIUM") return "badge-medium";
  if (priority === "LOW") return "badge-low";
  return "badge-none";
}

export default async function ReviewPage() {
  let items: ReviewItem[] = [];
  let error: string | null = null;

  try {
    const workspaces = await api.workspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error("No workspace found");
    items = await api.reviewItems(ws.id);
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
                <div className="review-title">
                  {item.emailThread.subject ?? "(no subject)"}
                </div>
                {item.emailMessage && (
                  <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
                    From:{" "}
                    {item.emailMessage.senderName ??
                      item.emailMessage.senderEmail}
                  </div>
                )}
                <p className="review-reason">{item.reason}</p>
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
                  <span
                    className={`badge ${priorityClass(
                      item.classification.priority
                    )}`}
                  >
                    {item.classification.priority}
                  </span>
                  <span className="badge">
                    {Math.round(item.classification.confidence * 100)}%
                    confidence
                  </span>
                  <span className="badge">
                    {item.classification.urgency}
                  </span>
                </div>
              )}
            </div>

            {item.emailMessage?.snippet && (
              <p
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  color: "var(--color-text-secondary)",
                  borderTop: "1px solid var(--color-border-light)",
                  paddingTop: 10,
                }}
              >
                {item.emailMessage.snippet}
              </p>
            )}

            {item.emailThread.tags.length > 0 && (
              <div className="inline-tags">
                {item.emailThread.tags.map((et) => (
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
        ))
      )}
    </>
  );
}
