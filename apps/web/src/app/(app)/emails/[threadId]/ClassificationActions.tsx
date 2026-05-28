"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type TriageStatus } from "@/lib/api";

type Props = {
  workspaceId: string;
  threadId: string;
  triageStatus: TriageStatus;
  hasClassification: boolean;
  isClassifying: boolean;
  /** classifyingAt is set — a classify job is already enqueued or in progress. */
  isQueued: boolean;
  modelProvider?: string | null;
  modelName?: string | null;
};

export function ClassificationActions({
  workspaceId,
  threadId,
  triageStatus: _triageStatus,
  hasClassification,
  isClassifying,
  isQueued,
  modelProvider,
  modelName,
}: Props) {
  const router = useRouter();
  const [sortLoading, setSortLoading] = useState(false);
  // analyzeLoading — post-MVP, required by Re-analyze button
  // const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Disable all actions while a job is in flight, active, or already queued.
  const busy = sortLoading || isClassifying || isQueued;

  async function handleRetrySort() {
    setError(null);
    setSortLoading(true);
    try {
      await api.aiClassify(workspaceId, threadId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sort failed");
    } finally {
      setSortLoading(false);
    }
  }

  // handleReanalyze — post-MVP, required by Re-analyze button
  // async function handleReanalyze() { ... }

  // analyzeLabel — post-MVP, required by Re-analyze button
  // function analyzeLabel(): string { ... }

  function sortLabel(): string {
    if (sortLoading) return "Sorting…";
    return hasClassification ? "Retry sorting" : "Sort thread";
  }

  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={handleRetrySort}
          disabled={busy}
          className="btn-primary"
        >
          {sortLabel()}
        </button>

        {/* Re-analyze — post-MVP, requires paid-tier LLM triage */}
        {/* {hasClassification && (
          <button
            onClick={handleReanalyze}
            disabled={busy}
            className="btn-secondary"
          >
            {analyzeLabel()}
          </button>
        )} */}

        {modelProvider && modelName && (
          <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
            Last: {modelProvider} / {modelName}
          </span>
        )}
      </div>
      {error && (
        <div className="error-box" style={{ marginTop: "10px" }}>
          {error}
        </div>
      )}
    </div>
  );
}
