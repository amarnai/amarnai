"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type TriageStatus } from "@/lib/api";

type Props = {
  workspaceId: string;
  threadId: string;
  triageStatus: TriageStatus;
  hasClassification: boolean;
  modelProvider?: string | null;
  modelName?: string | null;
};

export function ClassificationActions({
  workspaceId,
  threadId,
  triageStatus,
  hasClassification,
  modelProvider,
  modelName,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = triageStatus === "PENDING";

  async function handleRetry() {
    setError(null);
    setLoading(true);
    try {
      await api.aiClassify(workspaceId, threadId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setLoading(false);
    }
  }

  function buttonLabel(): string {
    if (loading) return "Sorting…";
    if (isPending) return "Pending…";
    return hasClassification ? "Retry sorting" : "Sort thread";
  }

  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={handleRetry}
          disabled={loading || isPending}
          className="btn-primary"
        >
          {buttonLabel()}
        </button>
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
