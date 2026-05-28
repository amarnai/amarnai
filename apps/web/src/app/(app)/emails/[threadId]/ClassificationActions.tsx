"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type TriageStatus } from "@/lib/api";
import { cancelClassifyAction } from "@/actions/gmail";

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
  const [stopLoading, setStopLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSortingInProgress = isClassifying || isQueued;

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

  async function handleStopSorting() {
    setError(null);
    setStopLoading(true);
    try {
      await cancelClassifyAction(workspaceId, threadId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop sorting");
    } finally {
      setStopLoading(false);
    }
  }

  function sortLabel(): string {
    if (sortLoading) return "Sorting…";
    return hasClassification ? "Retry sorting" : "Sort thread";
  }

  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        {isSortingInProgress ? (
          <button
            onClick={handleStopSorting}
            disabled={stopLoading}
            className="btn-ghost btn-danger"
          >
            {stopLoading ? "Stopping…" : "Stop sorting"}
          </button>
        ) : (
          <button
            onClick={handleRetrySort}
            disabled={sortLoading}
            className="btn-primary"
          >
            {sortLabel()}
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
