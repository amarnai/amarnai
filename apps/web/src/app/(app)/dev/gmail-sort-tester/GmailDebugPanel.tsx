"use client";

import { useState, useEffect } from "react";
import { api, type GmailSortResult, type GmailSortPathStep } from "@/lib/api";

type Props = {
  workspaceId: string;
};

export function GmailDebugPanel({ workspaceId }: Props) {
  const [threadId, setThreadId] = useState("");
  const [recentThreads, setRecentThreads] = useState<Array<{ id: string; subject: string | null }> | null>(null);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [sortResult, setSortResult] = useState<GmailSortResult | null>(null);
  const [sortLoading, setSortLoading] = useState(false);
  const [sortError, setSortError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecentLoading(true);
    setRecentError(null);
    api
      .gmailRecentThreads(workspaceId)
      .then((data) => {
        if (!cancelled) setRecentThreads(data.threads);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setRecentError(err instanceof Error ? err.message : "Could not load recent threads.");
      })
      .finally(() => {
        if (!cancelled) setRecentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function handleSort(e: React.FormEvent) {
    e.preventDefault();
    if (!threadId.trim()) return;
    setSortResult(null);
    setSortError(null);
    setSortLoading(true);
    try {
      const data = await api.sortGmailThread(workspaceId, threadId.trim());
      setSortResult(data);
    } catch (err: unknown) {
      setSortError(
        err instanceof Error ? err.message : "Sort failed. Check that the thread ID is valid."
      );
    } finally {
      setSortLoading(false);
    }
  }

  const cls = sortResult?.classification;
  const dbg = sortResult?.debug;

  // Top-N scores helper (sorted descending, capped at 10)
  function topScores(
    scores: Record<string, number>,
    names: Record<string, string>,
    limit = 10
  ): Array<{ id: string; name: string; score: number }> {
    return Object.entries(scores)
      .map(([id, score]) => ({ id, name: names[id] ?? id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const DECISION_SOURCE_LABELS: Record<string, { label: string; color: string }> = {
    embedding_auto:  { label: "Embedding auto-routing",   color: "var(--color-success, #16a34a)" },
    embedding_inbox: { label: "Embedding — stayed in Inbox", color: "var(--color-subtle)" },
    llm:             { label: "LLM fallback",              color: "var(--color-warning, #d97706)" },
    inbox_fallback:  { label: "Inbox fallback (failure)",  color: "var(--color-error, #dc2626)" },
  };

  return (
    <section className="settings-section">
      {/* Recent thread IDs */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--color-subtle)", marginBottom: 6 }}>
          Recent threads from your inbox:
        </div>
        {recentLoading && (
          <span style={{ fontSize: 12, color: "var(--color-subtle)" }}>Loading…</span>
        )}
        {recentError && (
          <span style={{ fontSize: 12, color: "var(--color-danger, #dc2626)" }}>{recentError}</span>
        )}
        {recentThreads && recentThreads.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--color-subtle)" }}>No threads found.</span>
        )}
        {recentThreads && recentThreads.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recentThreads.map(({ id, subject }) => (
              <button
                key={id}
                type="button"
                className="btn-secondary"
                style={{ fontSize: 12, padding: "4px 10px", textAlign: "left", display: "flex", gap: 10, alignItems: "baseline" }}
                onClick={() => setThreadId(id)}
              >
                <span style={{ fontFamily: "monospace", flexShrink: 0 }}>{id}</span>
                {subject && (
                  <span style={{ color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {subject}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sort form */}
      <form onSubmit={handleSort} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="form-group">
          <label className="form-label">
            Gmail Thread ID <span className="required">*</span>
          </label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. 17abc123def45678"
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            maxLength={64}
            style={{ fontFamily: "monospace" }}
          />
        </div>

        {sortError && <div className="error-box" style={{ marginBottom: 0 }}>{sortError}</div>}

        <div className="form-actions" style={{ paddingTop: 0 }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={sortLoading || !threadId.trim()}
          >
            {sortLoading ? "Sorting…" : "Sort Thread"}
          </button>
        </div>
      </form>

      {/* Sort result */}
      {sortResult && cls && (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── Step 1: Thread snapshot ───────────────────────────────────── */}
          <div className="card card-body">
            <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-subtle)" }}>
              Step 1 · Thread Snapshot
            </h3>
            <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 3 }}>
              <div>
                <strong>Subject:</strong>{" "}
                {sortResult.snapshot.subject ?? <em style={{ color: "var(--color-subtle)" }}>no subject</em>}
              </div>
              <div><strong>Messages:</strong> {sortResult.snapshot.messageCount}</div>
              <div>
                <strong>Latest:</strong>{" "}
                {new Date(sortResult.snapshot.latestMessageAt).toLocaleString()}
              </div>
              {sortResult.snapshot.participants.length > 0 && (
                <div><strong>Participants:</strong> {sortResult.snapshot.participants.join(", ")}</div>
              )}
            </div>
          </div>

          {/* ── Step 2: Embed sorting ─────────────────────────────────────── */}
          {dbg && (
            <div className="card card-body">
              <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-subtle)" }}>
                Step 2 · Embed Sorting
              </h3>

              {dbg.updatedEmbeddingsCount > 0 && (
                <p style={{ fontSize: 12, color: "var(--color-subtle)", marginBottom: 10 }}>
                  ↻ {dbg.updatedEmbeddingsCount} node embedding{dbg.updatedEmbeddingsCount !== 1 ? "s" : ""} recomputed
                </p>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* Raw cosine similarities */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-subtle)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Raw Similarities (top 10)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {topScores(dbg.rawSimilarities, dbg.nodeNames).map(({ id, name, score }) => (
                      <div key={id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, gap: 8 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                        <span style={{ fontFamily: "monospace", flexShrink: 0, color: "var(--color-subtle)" }}>
                          {score.toFixed(3)}
                        </span>
                      </div>
                    ))}
                    {Object.keys(dbg.rawSimilarities).length === 0 && (
                      <span style={{ fontSize: 12, color: "var(--color-subtle)" }}>—</span>
                    )}
                  </div>
                </div>

                {/* Subtree scores */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-subtle)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Subtree Scores (top 10)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {topScores(dbg.subtreeScores, dbg.nodeNames).map(({ id, name, score }) => (
                      <div key={id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, gap: 8 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                        <span style={{ fontFamily: "monospace", flexShrink: 0, color: "var(--color-subtle)" }}>
                          {score.toFixed(3)}
                        </span>
                      </div>
                    ))}
                    {Object.keys(dbg.subtreeScores).length === 0 && (
                      <span style={{ fontSize: 12, color: "var(--color-subtle)" }}>—</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Traversal path */}
              {dbg.path.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-subtle)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Traversal Path
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {dbg.path.map((step: GmailSortPathStep, i: number) => (
                      <div key={step.edgeId} style={{ fontSize: 12, display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ color: "var(--color-subtle)", fontFamily: "monospace", flexShrink: 0 }}>
                          {i + 1}.
                        </span>
                        <span>
                          <strong>{dbg.nodeNames[step.sourceNodeId] ?? step.sourceNodeId}</strong>
                          {" → "}
                          <strong>{dbg.nodeNames[step.targetNodeId] ?? step.targetNodeId}</strong>
                        </span>
                        <span style={{ color: "var(--color-subtle)", marginLeft: "auto", flexShrink: 0, fontFamily: "monospace" }}>
                          {Math.round(step.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Final result ──────────────────────────────────────── */}
          <div className="card card-body">
            <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-subtle)" }}>
              Step 3 · Final Result
            </h3>

            {/* Decision source badge */}
            {cls.decisionSource && (() => {
              const src = DECISION_SOURCE_LABELS[cls.decisionSource];
              return (
                <div style={{ marginBottom: 12, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--color-subtle)" }}>Decision source:</span>
                  <span style={{ fontWeight: 600, color: src?.color ?? "inherit" }}>
                    {src?.label ?? cls.decisionSource}
                  </span>
                </div>
              );
            })()}

            {/* Classification */}
            <div className="meta-grid" style={{ marginBottom: 12 }}>
              <div>
                <div className="meta-label">Destination</div>
                <div className="meta-value">
                  {cls.finalNodeName ?? cls.finalNodeId ?? (
                    <span style={{ color: "var(--color-warning)" }}>Unclassified</span>
                  )}
                </div>
              </div>
              <div>
                <div className="meta-label">Confidence</div>
                <div className="meta-value">{Math.round(cls.confidence * 100)}%</div>
              </div>
            </div>

            {cls.explanation && (
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
                {cls.explanation}
              </p>
            )}

            {cls.needsHumanReview && (
              <div className="warning-box" style={{ marginBottom: 8 }}>
                Flagged for human review
                {sortResult.reviewItemCreated ? " — review item created" : ""}
              </div>
            )}

            {(cls.modelProvider ?? cls.modelName) && (
              <p style={{ fontSize: 11, color: "var(--color-subtle)", marginBottom: 0 }}>
                {[cls.modelProvider, cls.modelName].filter(Boolean).join(" / ")}
              </p>
            )}
          </div>

        </div>
      )}
    </section>
  );
}
