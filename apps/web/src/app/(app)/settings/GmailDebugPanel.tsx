"use client";

import { useState, useEffect } from "react";
import { api, type GmailSortResult } from "@/lib/api";

type Props = {
  workspaceId: string;
};

export function GmailDebugPanel({ workspaceId }: Props) {
  const [threadId, setThreadId] = useState("");
  const [recentIds, setRecentIds] = useState<string[] | null>(null);
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
        if (!cancelled) setRecentIds(data.threadIds);
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

  return (
    <section className="settings-section" style={{ borderTop: "1px solid var(--color-border)", paddingTop: 24 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Gmail Sort Tester
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--color-warning-subtle, #fef3c7)",
            color: "var(--color-warning, #92400e)",
          }}
        >
          DEV ONLY
        </span>
      </h2>
      <p style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 16 }}>
        Fetch a real Gmail thread by ID, run the sorting pipeline, and inspect the result.
        Results are persisted. Body text is never stored.
      </p>

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
        {recentIds && recentIds.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--color-subtle)" }}>No threads found.</span>
        )}
        {recentIds && recentIds.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {recentIds.map((id) => (
              <button
                key={id}
                type="button"
                className="btn-secondary"
                style={{ fontSize: 12, padding: "2px 8px", fontFamily: "monospace" }}
                onClick={() => setThreadId(id)}
              >
                {id}
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
        <div className="card card-body" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Sort Result</h3>

          {/* Snapshot summary */}
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <div>
              <strong>Subject:</strong>{" "}
              {sortResult.snapshot.subject ?? <em style={{ color: "var(--color-subtle)" }}>no subject</em>}
            </div>
            <div>
              <strong>Messages:</strong> {sortResult.snapshot.messageCount}
            </div>
            <div>
              <strong>Latest:</strong>{" "}
              {new Date(sortResult.snapshot.latestMessageAt).toLocaleString()}
            </div>
            {sortResult.snapshot.participants.length > 0 && (
              <div>
                <strong>Participants:</strong> {sortResult.snapshot.participants.join(", ")}
              </div>
            )}
          </div>

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
            <div>
              <div className="meta-label">Priority</div>
              <div className="meta-value">{cls.priority}</div>
            </div>
            <div>
              <div className="meta-label">Urgency</div>
              <div className="meta-value">{cls.urgency}</div>
            </div>
            <div>
              <div className="meta-label">Risk</div>
              <div className="meta-value">{cls.riskLevel}</div>
            </div>
            <div>
              <div className="meta-label">Required Action</div>
              <div className="meta-value">{cls.requiredAction}</div>
            </div>
            <div>
              <div className="meta-label">Sensitivity</div>
              <div className="meta-value">{cls.sensitivity}</div>
            </div>
            <div>
              <div className="meta-label">Next Step</div>
              <div className="meta-value">{cls.suggestedNextStep}</div>
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
      )}
    </section>
  );
}
