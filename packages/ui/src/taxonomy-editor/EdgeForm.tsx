"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import type { TaxonomyNode, TaxonomyEdge, UpdateTaxonomyEdgeInput } from "@amarnai/api-client";
import "./taxonomy-editor.css";

export type EdgeFormProps = {
  edge: TaxonomyEdge;
  nodes: TaxonomyNode[];
  onSubmit: (data: UpdateTaxonomyEdgeInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
  submitting: boolean;
  error: string | null;
};

/**
 * Edit-only: opened by clicking a Path on the canvas. New Paths are created via
 * the folder's Parent picker or by dragging a connection between folders.
 */
export function EdgeForm({
  edge,
  nodes,
  onSubmit,
  onCancel,
  onDelete,
  submitting,
  error,
}: EdgeFormProps) {
  const [sourceNodeId, setSourceNodeId] = useState(edge.sourceNodeId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(
      sourceNodeId !== edge.sourceNodeId
        ? ({ newSourceNodeId: sourceNodeId } satisfies UpdateTaxonomyEdgeInput)
        : ({} satisfies UpdateTaxonomyEdgeInput)
    );
  }

  const childName =
    nodes.find((n) => n.id === edge.targetNodeId)?.name ?? edge.targetNodeId;

  return (
    <div>
      <h2 className="tx-modal-title">
        <Trans>Edit Path</Trans>
      </h2>
      {error && (
        <p className="tx-error" role="alert">
          {error}
        </p>
      )}
      <form className="tx-form" onSubmit={handleSubmit}>
        <div className="tx-field">
          <label className="tx-label" htmlFor="tx-edge-parent">
            <Trans>Parent</Trans>
          </label>
          <select
            id="tx-edge-parent"
            className="tx-select"
            value={sourceNodeId}
            onChange={(e) => setSourceNodeId(e.target.value)}
          >
            {nodes
              .filter((n) => !n.isCatchAll || n.id === edge.sourceNodeId)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
        </div>

        {/* The child end is fixed: moving a path means changing where it comes
            from, and re-targeting it would just be a different path. */}
        <div className="tx-field">
          <span className="tx-label">
            <Trans>Child folder</Trans>
          </span>
          <p className="tx-lead">{childName}</p>
        </div>

        <div className="tx-actions">
          <button className="tx-btn tx-btn--primary" type="submit" disabled={submitting}>
            {submitting ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </button>
          <button className="tx-btn tx-btn--ghost" type="button" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </button>
          {onDelete && (
            <button
              className="tx-btn tx-btn--danger"
              type="button"
              onClick={onDelete}
              disabled={submitting}
            >
              <Trans>Delete</Trans>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
