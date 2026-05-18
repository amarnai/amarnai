import { api, type Tag } from "@/lib/api";

export default async function TagsPage() {
  let tags: Tag[] = [];
  let error: string | null = null;

  try {
    const workspaces = await api.workspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error("No workspace found");
    tags = await api.tags(ws.id);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <h1>Tags</h1>
      {error && <div className="error-box">{error}</div>}

      {tags.length === 0 && !error ? (
        <p className="empty">No tags</p>
      ) : (
        <div className="tags-grid">
          {tags.map((tag) => (
            <div key={tag.id} className="tag-card">
              <div
                className="tag-dot"
                style={{ background: tag.color ?? "var(--ink-tint-border)" }}
              />
              <div>
                <div className="tag-name">{tag.name}</div>
                <div className="tag-source">{tag.source}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
