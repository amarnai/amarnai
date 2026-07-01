"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { TaxonomyNode } from "@amarnai/shared";
import type { IgnoredReason } from "@amarnai/core/taxonomy";
import { Tooltip } from "../Tooltip.js";
import { Glyph, NavGlyph, FOLDER_GLYPH } from "../icons/glyphs.js";
import "./taxonomy-node-card.css";

export type TaxonomyNodeData = { node: TaxonomyNode; ignoredReason: IgnoredReason };
export type TaxonomyRFNode = Node<TaxonomyNodeData, "taxonomy">;

export interface TaxonomyNodeCardBaseProps {
  name: string;
  description?: string;
  isRoot: boolean;
  isCatchAll?: boolean;
  ignoredReason?: IgnoredReason;
  selected?: boolean;
}

export function TaxonomyNodeCardBase({
  name,
  description,
  isRoot,
  isCatchAll = false,
  ignoredReason = null,
  selected = false,
}: TaxonomyNodeCardBaseProps) {
  const { _ } = useLingui();
  const ignored = ignoredReason !== null;
  const title = ignoredReason === "no-incoming"
    ? _(msg`This folder is not reachable from the inbox and will not be used for routing.`)
    : undefined;
  const catchAllHint = _(
    msg`Automated and bulk mail that doesn't fit another folder lands here automatically. This is different from Needs review, which holds threads too ambiguous for the assistant to sort.`,
  );

  const card = (
    <div
      className={`taxonomy-node-card${selected ? " selected" : ""}${ignored ? " unreachable" : ""}`}
    >
      {!isRoot && <Handle type="target" position={Position.Left} />}
      {/* The inbox root and catch-all carry fixed, English-seeded copy that is
          localized here at the render edge (they are never user-editable). */}
      <div className="node-name">
        {/* The inbox root is the mailbox itself; every other node is a folder
            (catch-all included), matching the folder icon on the emails page. */}
        <span className="node-icon" aria-hidden>
          {isRoot ? <NavGlyph name="emails" size={13} /> : <Glyph svg={FOLDER_GLYPH} />}
        </span>
        <span className="node-label">
          {isRoot ? (
            <Trans>Inbox</Trans>
          ) : isCatchAll ? (
            <Trans>Updates / Other</Trans>
          ) : (
            name
          )}
        </span>
      </div>
      {(isCatchAll || description) && (
        <div className="node-description">
          {isCatchAll ? (
            <Trans>
              Automated notifications, newsletters, and service updates that
              don't fit another folder.
            </Trans>
          ) : (
            description
          )}
        </div>
      )}
      <div className="node-badges">
        {isRoot && <span className="badge node-kind node-kind-rule"><Trans>Entry</Trans></span>}
        {isCatchAll && (
          <Tooltip content={catchAllHint}>
            <span className="badge node-kind node-kind-catchall"><Trans>Catch-all</Trans></span>
          </Tooltip>
        )}
        {ignored && <span className="badge badge-unreachable"><Trans>Ignored</Trans></span>}
      </div>
      {/* The catch-all must stay a leaf (it is excluded from routing), so it
          can never be the source of a path: no outgoing handle. */}
      {!isCatchAll && <Handle type="source" position={Position.Right} />}
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
      isCatchAll={node.isCatchAll ?? false}
      ignoredReason={ignoredReason}
    />
  );
}
