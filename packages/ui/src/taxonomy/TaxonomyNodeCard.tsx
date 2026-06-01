"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { TaxonomyNode } from "@amarnai/shared";
import type { IgnoredReason } from "./utils.js";

export type TaxonomyNodeData = { node: TaxonomyNode; ignoredReason: IgnoredReason };
export type TaxonomyRFNode = Node<TaxonomyNodeData, "taxonomy">;

export function TaxonomyNodeCard({ data }: NodeProps<TaxonomyRFNode>) {
  const { node, ignoredReason } = data;
  const ignored = ignoredReason !== null;
  const tooltipText =
    ignoredReason === "no-incoming"
      ? "This node has no incoming edge and will not be used."
      : undefined;

  return (
    <div
      className={`taxonomy-node-card${ignored ? " unreachable" : ""}`}
      title={tooltipText}
    >
      {!node.isRoot && <Handle type="target" position={Position.Left} />}
      <div className="node-name">{node.name}</div>
      {node.description && (
        <div className="node-description">{node.description}</div>
      )}
      <div className="node-badges">
        {node.isRoot ? (
          <span className="badge node-kind node-kind-rule">Entry</span>
        ) : (
          <span className="badge node-kind node-kind-category">Category</span>
        )}
        {ignored && <span className="badge badge-unreachable">Ignored</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
