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
  modelProvider?: string | null;
  modelName?: string | null;
};

export function ClassificationActions({
  workspaceId,
  threadId,
  triageStatus: _triageStatus,
  hasClassification,
  isClassifying,
  modelProvider,
  modelName,
}: Props) {
  const router = useRouter();
  const [sortLoading, setSortLoading] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = sortLoading || analyzeLoading || isClassifying;

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

  async function handleReanalyze() {
    setError(null);
    setAnalyzeLoading(true);
    try {
      await api.aiTriage(workspaceId, threadId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-analyze failed");
    } finally {
      setAnalyzeLoading(false);
    }
  }

  // Use only local loading state for button labels — isClassifying is true for
  // both sort and re-analyze operations and can't distinguish between them.
  function sortLabel(): string {
    if (sortLoading) return "Sorting…";
    return hasClassification ? "Retry sorting" : "Sort thread";
  }

  function analyzeLabel(): string {
    if (analyzeLoading) return "Analyzing…";
    return "Re-analyze";
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

        {/* Re-analyze is only meaningful when a classification already exists */}
        {hasClassification && (
          <button
            onClick={handleReanalyze}
            disabled={busy}
            className="btn-secondary"
          >
            {analyzeLabel()}
          </button>
        )}

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
