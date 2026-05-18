"use client";

import { useState } from "react";
import Link from "next/link";
import { api, type EmailThreadSummary, type MockInboxResult } from "@/lib/api";

type Props = {
  workspaceId: string;
  threads: EmailThreadSummary[];
};

type Mode = "new_thread" | "existing_thread";

export function MockInboxClient({ workspaceId, threads }: Props) {
  const [mode, setMode] = useState<Mode>("new_thread");
  const [threadId, setThreadId] = useState<string>(threads[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [result, setResult] = useState<MockInboxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const data = await api.mockInboxEvent(
        workspaceId,
        mode === "new_thread"
          ? {
              mode: "new_thread",
              subject: subject || undefined,
              senderName: senderName || undefined,
              senderEmail,
              bodyText,
            }
          : {
              mode: "existing_thread",
              threadId,
              senderName: senderName || undefined,
              senderEmail,
              bodyText,
            }
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const cls = result?.classification;

  return (
    <div style={{ display: "grid", gap: 24, maxWidth: 680 }}>
      <form onSubmit={handleSubmit} className="card card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Mode */}
        <div className="form-group">
          <label className="form-label">Mode</label>
          <select
            className="form-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
          >
            <option value="new_thread">New Thread</option>
            <option value="existing_thread">Existing Thread</option>
          </select>
        </div>

        {/* Thread selector — existing thread only */}
        {mode === "existing_thread" && (
          <div className="form-group">
            <label className="form-label">
              Thread <span className="required">*</span>
            </label>
            {threads.length === 0 ? (
              <p style={{ fontSize: 13, color: "#9ca3af" }}>No threads available — create one first.</p>
            ) : (
              <select
                className="form-select"
                value={threadId}
                onChange={(e) => setThreadId(e.target.value)}
                required
              >
                {threads.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.subject ?? "(no subject)"} · {t.messageCount} msg{t.messageCount === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Subject — new thread only */}
        {mode === "new_thread" && (
          <div className="form-group">
            <label className="form-label">Subject</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Invoice #INV-2026-0099"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={500}
            />
          </div>
        )}

        {/* Sender name */}
        <div className="form-group">
          <label className="form-label">Sender Name</label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. Alice Smith"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            maxLength={200}
          />
        </div>

        {/* Sender email */}
        <div className="form-group">
          <label className="form-label">
            Sender Email <span className="required">*</span>
          </label>
          <input
            className="form-input"
            type="email"
            placeholder="e.g. alice@example.com"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            required
          />
        </div>

        {/* Body text */}
        <div className="form-group">
          <label className="form-label">
            Body Text <span className="required">*</span>
          </label>
          <textarea
            className="form-textarea"
            placeholder="Email body..."
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={5}
            required
            maxLength={10000}
          />
        </div>

        {error && <div className="error-box" style={{ marginBottom: 0 }}>{error}</div>}

        <div className="form-actions" style={{ paddingTop: 0 }}>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "Simulating…" : "Simulate Incoming Email"}
          </button>
        </div>
      </form>

      {result && cls && (
        <div className="card card-body">
          <h2 style={{ marginTop: 0, marginBottom: 16 }}>Result</h2>

          {/* Thread link */}
          <p style={{ marginBottom: 16, fontSize: 13 }}>
            <Link href={`/emails/${result.thread.id}`}>View thread →</Link>
            <span style={{ color: "#9ca3af" }}>
              {" · "}{result.thread.isNew ? "new thread" : "existing thread"}
              {" · "}{result.thread.messageCount} message{result.thread.messageCount === 1 ? "" : "s"}
            </span>
          </p>

          {/* Classification metadata grid */}
          <div className="meta-grid">
            <div>
              <div className="meta-label">Final Node</div>
              <div className="meta-value">{cls.finalNode.name}</div>
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

          {/* Path */}
          <div style={{ marginBottom: 12 }}>
            <div className="meta-label" style={{ marginBottom: 6 }}>Path</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {cls.path.map((step, i) => (
                <span key={step.nodeId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {i > 0 && <span style={{ color: "#9ca3af" }}>→</span>}
                  <span className="badge">{step.nodeName}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Explanation */}
          {cls.explanation && (
            <p style={{ fontSize: 13, color: "#374151", marginBottom: 12 }}>
              {cls.explanation}
            </p>
          )}

          {/* Review notice */}
          {cls.needsHumanReview && (
            <div className="warning-box" style={{ marginBottom: 0 }}>
              Flagged for human review
              {result.reviewItemCreated ? " — review item created" : ""}
              {result.reviewItemId && (
                <span style={{ marginLeft: 8 }}>
                  <Link href="/review">Go to review queue →</Link>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
