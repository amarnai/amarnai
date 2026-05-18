"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Props = {
  workspaceId: string;
  threadId: string;
  modelProvider?: string | null;
  modelName?: string | null;
};

export function ClassificationActions({ workspaceId, threadId, modelProvider, modelName }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"ai" | "mock" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runClassification(type: "ai" | "mock") {
    setError(null);
    setLoading(type);
    try {
      if (type === "ai") {
        await api.aiClassify(workspaceId, threadId);
      } else {
        await api.mockClassifyThread(workspaceId, threadId);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => runClassification("ai")}
          disabled={loading !== null}
          className="btn-primary"
        >
          {loading === "ai" ? "Classifying…" : "Run AI classification"}
        </button>
        <button
          onClick={() => runClassification("mock")}
          disabled={loading !== null}
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: loading !== null ? "not-allowed" : "pointer",
            fontSize: "14px",
            color: "#374151",
          }}
        >
          {loading === "mock" ? "Classifying…" : "Run mock classification"}
        </button>
        {modelProvider && modelName && (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
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
