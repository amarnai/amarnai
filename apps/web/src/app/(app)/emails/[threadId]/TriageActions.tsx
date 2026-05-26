"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type TriageStatus, type TaxonomyNode } from "@/lib/api";

type Props = {
  workspaceId: string;
  threadId: string;
  triageStatus: TriageStatus;
  nodes: TaxonomyNode[];
};

export function TriageActions({ workspaceId, threadId, triageStatus, nodes }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState("");

  const leafNodes = nodes.filter((n) => !n.isRoot);

  async function handleApprove() {
    setError(null);
    setLoading(true);
    try {
      await api.triageThread(workspaceId, threadId, { action: "approve" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setLoading(false);
    }
  }

  async function handleMove() {
    if (!selectedNodeId) return;
    setError(null);
    setLoading(true);
    try {
      await api.triageThread(workspaceId, threadId, { action: "move", nodeId: selectedNodeId });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move thread");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="triage-actions">
      {/* Status badge */}
      <span className={`triage-badge triage-badge-${triageStatus.toLowerCase()}`}>
        {triageStatus === "SORTED" && "✓ Sorted"}
        {triageStatus === "NEEDS_REVIEW" && "⚠ Needs review"}
        {triageStatus === "PENDING" && "· Pending"}
      </span>

      <div className="triage-controls">
        {/* Approve button — only shown when NEEDS_REVIEW */}
        {triageStatus === "NEEDS_REVIEW" && (
          <button
            className="btn-primary"
            onClick={handleApprove}
            disabled={loading}
            type="button"
          >
            {loading ? "Saving…" : "Approve sorting"}
          </button>
        )}

        {/* Move to node — available always */}
        {leafNodes.length > 0 && (
          <div className="triage-move">
            <select
              className="triage-select"
              value={selectedNodeId}
              onChange={(e) => setSelectedNodeId(e.target.value)}
              disabled={loading}
            >
              <option value="">Move to…</option>
              {leafNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary"
              onClick={handleMove}
              disabled={loading || !selectedNodeId}
              type="button"
            >
              Move
            </button>
          </div>
        )}
      </div>

      {error && <div className="error-box triage-error">{error}</div>}
    </div>
  );
}
