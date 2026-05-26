"use client";

import { useState } from "react";
import Link from "next/link";
import { api, type EmailThreadSummary, type MockInboxResult, type CandidateNodeResult, type LLMNodeSelectionResult } from "@/lib/api";

type Props = {
  workspaceId: string;
  threads: EmailThreadSummary[];
};

type Mode = "new_thread" | "existing_thread";
type Classifier = "mock" | "ai";

export function MockInboxClient({ workspaceId, threads }: Props) {
  const [mode, setMode] = useState<Mode>("new_thread");
  const [classifier, setClassifier] = useState<Classifier>("mock");
  const [threadId, setThreadId] = useState<string>(threads[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [result, setResult] = useState<MockInboxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [candidatePaths, setCandidatePaths] = useState<CandidateNodeResult | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [llmSelection, setLlmSelection] = useState<LLMNodeSelectionResult | null>(null);
  const [llmSelectionLoading, setLlmSelectionLoading] = useState(false);
  const [llmSelectionError, setLlmSelectionError] = useState<string | null>(null);

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
              classifier,
              subject: subject || undefined,
              senderName: senderName || undefined,
              senderEmail,
              bodyText,
            }
          : {
              mode: "existing_thread",
              classifier,
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

  async function handleLLMSelection() {
    setLlmSelectionError(null);
    setLlmSelection(null);
    setLlmSelectionLoading(true);
    try {
      const data = await api.llmNodeSelection(workspaceId, {
        emails: [
          {
            ...(subject ? { subject } : {}),
            ...(senderName ? { senderName } : {}),
            ...(senderEmail ? { senderEmail } : {}),
            ...(bodyText ? { bodyText } : {}),
          },
        ],
      });
      setLlmSelection(data);
      // Also update candidate paths display from the same result
      setCandidatePaths(data.candidateResult);
    } catch (err) {
      setLlmSelectionError(err instanceof Error ? err.message : String(err));
    } finally {
      setLlmSelectionLoading(false);
    }
  }

  async function handleSimulateCandidates() {
    setCandidatesError(null);
    setCandidatePaths(null);
    setCandidatesLoading(true);
    try {
      const data = await api.candidateNodes(workspaceId, {
        emails: [
          {
            ...(subject ? { subject } : {}),
            ...(senderName ? { senderName } : {}),
            ...(senderEmail ? { senderEmail } : {}),
            ...(bodyText ? { bodyText } : {}),
          },
        ],
      });
      setCandidatePaths(data);
    } catch (err) {
      setCandidatesError(err instanceof Error ? err.message : String(err));
    } finally {
      setCandidatesLoading(false);
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

        {/* Classifier */}
        <div className="form-group">
          <label className="form-label">Classifier</label>
          <select
            className="form-select"
            value={classifier}
            onChange={(e) => setClassifier(e.target.value as Classifier)}
          >
            <option value="mock">Mock (default)</option>
            <option value="ai">AI (uses configured AI_PROVIDER)</option>
          </select>
        </div>

        {/* Thread selector — existing thread only */}
        {mode === "existing_thread" && (
          <div className="form-group">
            <label className="form-label">
              Thread <span className="required">*</span>
            </label>
            {threads.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-subtle)" }}>No threads available — create one first.</p>
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
          <button
            type="button"
            disabled={candidatesLoading || !bodyText.trim()}
            className="btn-secondary"
            onClick={handleSimulateCandidates}
          >
            {candidatesLoading ? "Analyzing…" : "Simulate Candidate Paths"}
          </button>
          <button
            type="button"
            disabled={llmSelectionLoading || !bodyText.trim()}
            className="btn-secondary"
            onClick={handleLLMSelection}
          >
            {llmSelectionLoading ? "Selecting…" : "Simulate LLM Selection"}
          </button>
        </div>
      </form>

      {candidatesError && (
        <div className="error-box">{candidatesError}</div>
      )}

      {candidatePaths && (
        <div className="card card-body">
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>Candidate Paths</h2>

          {candidatePaths.diagnostics.queryText && (
            <p style={{ fontSize: 12, color: "var(--color-subtle)", marginBottom: 10 }}>
              Query tokens: <code>{candidatePaths.diagnostics.queryText}</code>
            </p>
          )}

          {candidatePaths.diagnostics.warnings.length > 0 && (
            <div className="warning-box" style={{ marginBottom: 12 }}>
              {candidatePaths.diagnostics.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          {candidatePaths.candidates.length === 0 ? (
            <p style={{ color: "var(--color-subtle)" }}>No valid candidate paths found.</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
              {candidatePaths.candidates.map((c) => (
                <li key={c.nodeId} style={{ fontSize: 13 }}>
                  <strong>{c.breadcrumb ?? c.name}</strong>
                  <span style={{ color: "var(--color-subtle)", marginLeft: 8 }}>
                    score: {c.score}
                  </span>
                  {c.reasons.length > 0 && (
                    <span style={{ color: "var(--color-subtle)", marginLeft: 8, fontSize: 11 }}>
                      [{c.reasons.join(", ")}]
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}

          {candidatePaths.diagnostics.matchedProfiles.length > 0 && (
            <p style={{ fontSize: 11, color: "var(--color-subtle)", marginTop: 10, marginBottom: 0 }}>
              Matched profiles: {candidatePaths.diagnostics.matchedProfiles.join(", ")}
            </p>
          )}
        </div>
      )}

      {llmSelectionError && (
        <div className="error-box">{llmSelectionError}</div>
      )}

      {llmSelection && (
        <div className="card card-body">
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>LLM Selection</h2>

          {/* Result */}
          <div className="meta-grid" style={{ marginBottom: 12 }}>
            <div>
              <div className="meta-label">Selected Node</div>
              <div className="meta-value">
                {llmSelection.result.finalNodeId
                  ? (llmSelection.candidateResult.candidates.find(
                      (c) => c.nodeId === llmSelection.result.finalNodeId
                    )?.name ?? llmSelection.result.finalNodeId)
                  : <span style={{ color: "var(--color-warning)" }}>Unclassified</span>
                }
              </div>
            </div>
            <div>
              <div className="meta-label">Confidence</div>
              <div className="meta-value">{Math.round(llmSelection.result.confidence * 100)}%</div>
            </div>
            <div>
              <div className="meta-label">Needs Review</div>
              <div className="meta-value">{llmSelection.result.needsHumanReview ? "Yes" : "No"}</div>
            </div>
          </div>

          {llmSelection.result.explanation && (
            <p style={{ fontSize: 13, marginBottom: 12 }}>{llmSelection.result.explanation}</p>
          )}

          {llmSelection.result.needsHumanReview && (
            <div className="warning-box" style={{ marginBottom: 12 }}>
              Flagged for human review
            </div>
          )}

          {/* Selection debug */}
          {llmSelection.debug && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ fontSize: 12, color: "var(--color-subtle)", cursor: "pointer", userSelect: "none" }}>
                Selection debug
              </summary>
              <div style={{ fontSize: 11, marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                <div><span style={{ color: "var(--color-subtle)" }}>rawSelectedNodeId:</span> <code>{llmSelection.debug.rawSelectedNodeId ?? "null"}</code></div>
                <div><span style={{ color: "var(--color-subtle)" }}>resolvedNodeId:</span> <code>{llmSelection.debug.resolvedNodeId ?? "null"}</code></div>
                <div><span style={{ color: "var(--color-subtle)" }}>resolvedBreadcrumb:</span> <code>{llmSelection.debug.resolvedBreadcrumb ?? "null"}</code></div>
                <div><span style={{ color: "var(--color-subtle)" }}>resolvedName:</span> <code>{llmSelection.debug.resolvedName ?? "null"}</code></div>
              </div>
            </details>
          )}

          {/* Raw LLM output */}
          {llmSelection.rawLLMOutput && (
            <details style={{ marginBottom: 0 }}>
              <summary style={{ fontSize: 12, color: "var(--color-subtle)", cursor: "pointer", userSelect: "none" }}>
                Raw LLM output
              </summary>
              <pre style={{ fontSize: 11, marginTop: 8, padding: 8, background: "var(--color-surface-alt)", borderRadius: 4, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {llmSelection.rawLLMOutput}
              </pre>
            </details>
          )}
        </div>
      )}

      {result && cls && (
        <div className="card card-body">
          <h2 style={{ marginTop: 0, marginBottom: 16 }}>Result</h2>

          {/* Thread link */}
          <p style={{ marginBottom: 16, fontSize: 13 }}>
            <Link href={`/emails/${result.thread.id}`}>View thread →</Link>
            <span style={{ color: "var(--color-subtle)" }}>
              {" · "}{result.thread.isNew ? "new thread" : "existing thread"}
              {" · "}{result.thread.messageCount} message{result.thread.messageCount === 1 ? "" : "s"}
            </span>
          </p>

          {/* Classification metadata grid */}
          <div className="meta-grid">
            <div>
              <div className="meta-label">Final Node</div>
              <div className="meta-value">{cls.finalNode?.name ?? "Unclassified"}</div>
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

          {/* Provider/model */}
          {(cls.modelProvider ?? cls.modelName) && (
            <p style={{ fontSize: 12, color: "var(--color-subtle)", marginBottom: 8 }}>
              {[cls.modelProvider, cls.modelName].filter(Boolean).join(" / ")}
            </p>
          )}

          {/* Explanation */}
          {cls.explanation && (
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
              {cls.explanation}
            </p>
          )}

          {/* Review notice */}
          {cls.needsHumanReview && (
            <div className="warning-box" style={{ marginBottom: 0 }}>
              Flagged for human review —{" "}
              <Link href="/review">Go to review queue →</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
