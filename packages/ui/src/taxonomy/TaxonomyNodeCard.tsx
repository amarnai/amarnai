"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { TaxonomyNode } from "@amarnai/shared";
import type { IgnoredReason } from "./utils.js";
import { Tooltip } from "../Tooltip.js";

export type TaxonomyNodeData = { node: TaxonomyNode; ignoredReason: IgnoredReason };
export type TaxonomyRFNode = Node<TaxonomyNodeData, "taxonomy">;

export interface TaxonomyNodeCardBaseProps {
  name: string;
  description?: string;
  isRoot: boolean;
  ignoredReason?: IgnoredReason;
  selected?: boolean;
}

export function TaxonomyNodeCardBase({
  name,
  description,
  isRoot,
  ignoredReason = null,
  selected = false,
}: TaxonomyNodeCardBaseProps) {
  const ignored = ignoredReason !== null;
  const title = ignoredReason === "no-incoming"
    ? "This node is not reachable from the inbox and will not be used for routing."
    : undefined;

  const card = (
    <div
      className={`taxonomy-node-card${selected ? " selected" : ""}${ignored ? " unreachable" : ""}`}
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

  return title ? <Tooltip content={title}>{card}</Tooltip> : card;
}

export function TaxonomyNodeCard({ data }: NodeProps<TaxonomyRFNode>) {
  const { node, ignoredReason } = data;

  return (
    <TaxonomyNodeCardBase
      name={node.name}
      {...(node.description ? { description: node.description } : {})}
      isRoot={node.isRoot}
      ignoredReason={ignoredReason}
    />
  );
}
