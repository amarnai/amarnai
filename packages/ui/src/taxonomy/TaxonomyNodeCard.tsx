"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { TaxonomyNode } from "@amarnai/shared";
import type { IgnoredReason } from "./utils.js";

export type TaxonomyNodeData = { node: TaxonomyNode; ignoredReason: IgnoredReason };
export type TaxonomyRFNode = Node<TaxonomyNodeData, "taxonomy">;

export interface TaxonomyNodeCardBaseProps {
  name: string;
  description?: string;
  isRoot: boolean;
  ignored?: boolean;
  selected?: boolean;
  title?: string;
}

export function TaxonomyNodeCardBase({
  name,
  description,
  isRoot,
  ignored = false,
  selected = false,
  title,
}: TaxonomyNodeCardBaseProps) {
  return (
    <div
      className={`taxonomy-node-card${selected ? " selected" : ""}${ignored ? " unreachable" : ""}`}
      title={title}
    >
      {!isRoot && <Handle type="target" position={Position.Left} />}
      <div className="node-name">{name}</div>
      {description && <div className="node-description">{description}</div>}
      <div className="node-badges">
        {isRoot && <span className="badge node-kind node-kind-rule">Entry</span>}
        {ignored && <span className="badge badge-unreachable">Ignored</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function TaxonomyNodeCard({ data }: NodeProps<TaxonomyRFNode>) {
  const { node, ignoredReason } = data;
  const title =
    ignoredReason === "no-incoming"
      ? "This node has no incoming edge and will not be used."
      : undefined;

  return (
    <TaxonomyNodeCardBase
      name={node.name}
      {...(node.description ? { description: node.description } : {})}
      isRoot={node.isRoot}
      ignored={ignoredReason !== null}
      {...(title ? { title } : {})}
    />
  );
}
