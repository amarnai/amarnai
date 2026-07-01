"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  BaseEdge,
  getBezierPath,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type EdgeProps,
  type OnNodeDrag,
  type OnConnect,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "@amarnai/ui";
import {
  api,
  type TaxonomyNode,
  type TaxonomyEdge,
  type CreateTaxonomyNodeInput,
  type UpdateTaxonomyEdgeInput,
} from "@/lib/api";
import {
  createTaxonomyNodeAction as createTaxonomyNodeActionRaw,
  updateTaxonomyNodeAction as updateTaxonomyNodeActionRaw,
  deleteTaxonomyNodeAction as deleteTaxonomyNodeActionRaw,
  createTaxonomyEdgeAction as createTaxonomyEdgeActionRaw,
  updateTaxonomyEdgeAction as updateTaxonomyEdgeActionRaw,
  deleteTaxonomyEdgeAction as deleteTaxonomyEdgeActionRaw,
  type ActionResult,
} from "@/actions/taxonomy";
import {
  computeIgnoredReasons,
  type IgnoredReason,
  TAXONOMY_TEMPLATES,
  matchesTemplate,
  localizeTemplate,
  descendantIds,
} from "@amarnai/core/taxonomy";
import {
  useTaxonomyHistory,
  snapshotsEqual,
  type GraphSnapshot,
} from "./useTaxonomyHistory";
import { GenerateFromInboxButton, startGmailConnect } from "./GenerateFromInboxButton";
import { TaxonomyNodeCardBase, readEdgeColors } from "@amarnai/ui/taxonomy";
import { Tooltip } from "@amarnai/ui";
import {
  TAXONOMY_MIN_NON_ROOT_NODES,
  countRoutableNonRootNodes,
  isTaxonomyRoutable,
  serializeTaxonomy,
  TaxonomyTransferFileSchema,
  validateTaxonomyTransfer,
  minNodeNameLength,
  minNodeDescriptionLength,
  type TaxonomyTransferFile,
} from "@amarnai/shared";
import { Trans, Plural } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { translateSource } from "@amarnai/i18n";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeById(nodes: TaxonomyNode[], id: string): TaxonomyNode | undefined {
  return nodes.find((n) => n.id === id);
}

// The taxonomy Server Actions return a result union instead of throwing, so
// their validation messages (e.g. "This node already has a parent") survive
// Next.js's production redaction of errors thrown across the action boundary.
// unwrap re-throws here on the client — where the message is NOT redacted — so
// the existing try/catch handlers can show it inline via setFormError/setApiError.
function unwrap<T>(res: ActionResult<T>): T {
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const createTaxonomyNodeAction = (
  ...args: Parameters<typeof createTaxonomyNodeActionRaw>
) => createTaxonomyNodeActionRaw(...args).then(unwrap);

const updateTaxonomyNodeAction = (
  ...args: Parameters<typeof updateTaxonomyNodeActionRaw>
) => updateTaxonomyNodeActionRaw(...args).then(unwrap);

const deleteTaxonomyNodeAction = (
  ...args: Parameters<typeof deleteTaxonomyNodeActionRaw>
) => deleteTaxonomyNodeActionRaw(...args).then(unwrap);

const createTaxonomyEdgeAction = (
  ...args: Parameters<typeof createTaxonomyEdgeActionRaw>
) => createTaxonomyEdgeActionRaw(...args).then(unwrap);

const updateTaxonomyEdgeAction = (
  ...args: Parameters<typeof updateTaxonomyEdgeActionRaw>
) => updateTaxonomyEdgeActionRaw(...args).then(unwrap);

const deleteTaxonomyEdgeAction = (
  ...args: Parameters<typeof deleteTaxonomyEdgeActionRaw>
) => deleteTaxonomyEdgeActionRaw(...args).then(unwrap);


// ─── React Flow node/edge converters ──────────────────────────────────────────

type RFNodeData = { node: TaxonomyNode; ignoredReason: IgnoredReason };
type RFNode = Node<RFNodeData, "taxonomy">;

function toRFNode(n: TaxonomyNode, ignoredReason: IgnoredReason): RFNode {
  return {
    id: n.id,
    type: "taxonomy",
    position: { x: n.positionX, y: n.positionY },
    data: { node: n, ignoredReason },
  };
}

function toRFNodes(nodes: TaxonomyNode[], edges: TaxonomyEdge[]): RFNode[] {
  const ignoredMap = computeIgnoredReasons(nodes, edges);
  return nodes.map((n) => toRFNode(n, ignoredMap.get(n.id) ?? null));
}

function toRFEdge(
  e: TaxonomyEdge,
  ignoredReasonsMap: Map<string, IgnoredReason>,
): Edge {
  const targetIgnored = ignoredReasonsMap.has(e.targetNodeId);
  const colors = readEdgeColors();
  return {
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: "taxonomy-edge",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: targetIgnored ? colors.warn : colors.default,
    },
    data: { targetIgnored },
  };
}

function toRFEdges(edges: TaxonomyEdge[], nodes: TaxonomyNode[]): Edge[] {
  const ignoredMap = computeIgnoredReasons(nodes, edges);
  return edges.map((e) => toRFEdge(e, ignoredMap));
}

// ─── Custom node component ────────────────────────────────────────────────────

function TaxonomyNodeCard({ data, selected }: NodeProps<RFNode>) {
  const { node, ignoredReason } = data;

  return (
    <TaxonomyNodeCardBase
      name={node.name}
      {...(node.description ? { description: node.description } : {})}
      isRoot={node.isRoot}
      isCatchAll={node.isCatchAll}
      ignoredReason={ignoredReason}
      selected={selected}
    />
  );
}

const nodeTypes = { taxonomy: TaxonomyNodeCard };

// ─── Custom edge component ────────────────────────────────────────────────────

type RFEdgeData = { targetIgnored: boolean };

function TaxonomyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const targetIgnored =
    (data as RFEdgeData | undefined)?.targetIgnored ?? false;
  const isWarning = targetIgnored;
  const colors = readEdgeColors();
  const strokeColor =
    isWarning && selected
      ? colors.warnSelected
      : selected
        ? colors.selected
        : isWarning
          ? colors.warn
          : colors.default;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      {...(markerEnd !== undefined ? { markerEnd } : {})}
      style={{
        stroke: strokeColor,
        strokeWidth: selected ? 2.5 : 1.5,
      }}
    />
  );
}

const edgeTypes = { "taxonomy-edge": TaxonomyEdge };

// ─── DescriptionTips ────────────────────────────────────────────────────────

function DescriptionTips() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--accent)",
          cursor: "pointer",
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        {open ? <Trans>Hide tips</Trans> : <Trans>How to write a good description</Trans>}
      </button>
      {open && (
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            color: "var(--color-foreground)",
            marginTop: 6,
            padding: "8px 10px",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border-input)",
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0 }}>
            <Trans>
              Describe what kinds of emails belong here: who they come from and
              what they are about. Be specific and use the actual names, topics,
              and words that show up in those emails. Describe what the emails
              are, not what you plan to do about them. The clearer your
              description, the more accurately your email is sorted here.
            </Trans>
          </p>
          <div
            style={{
              marginTop: 8,
              padding: "5px 8px",
              borderRadius: 5,
              background: "var(--color-success-bg)",
              color: "var(--color-success-text)",
            }}
          >
            ✓ <Trans>Receipts, payment confirmations, and billing questions from vendors.</Trans>
          </div>
          <div
            style={{
              marginTop: 6,
              padding: "5px 8px",
              borderRadius: 5,
              background: "var(--danger-soft)",
              color: "var(--danger)",
            }}
          >
            ✗ <Trans>Emails about my bills that I need to deal with.</Trans>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── NodeForm ─────────────────────────────────────────────────────────────────

// Re-parenting a folder reuses / creates / deletes its single incoming edge.
// `currentEdgeId` is the existing incoming edge (if any); `newParentId` is the
// chosen parent (null = disconnect).
type ParentChange = {
  currentEdgeId: string | null;
  newParentId: string | null;
};

type NodeFormSubmit = {
  data: CreateTaxonomyNodeInput;
  // create mode: chosen parent (null = orphan / no edge)
  parentId: string | null;
  // edit mode: present only when the parent actually changed
  parentChange?: ParentChange;
};

function NodeForm({
  node,
  nodes,
  edges,
  onSubmit,
  onCancel,
  onDelete,
  deleteDisabledReason,
  classificationCount = 0,
  otherNodes = [],
  submitting,
  error,
}: {
  node: TaxonomyNode | null;
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
  onSubmit: (submit: NodeFormSubmit) => void;
  onCancel: () => void;
  onDelete?: (moveToNodeId?: string) => void;
  deleteDisabledReason?: string | null;
  classificationCount?: number;
  otherNodes?: Pick<TaxonomyNode, "id" | "name">[];
  submitting: boolean;
  error: string | null;
}) {
  const { _ } = useLingui();
  const isRoot = node?.isRoot ?? false;

  // A folder's parent is modelled as a single "Parent" choice instead of a
  // standalone Path: the form reuses / creates / deletes the incoming edge as
  // needed (mirrors the mobile NodeFormSheet).
  const currentEdge = node
    ? (edges.find((e) => e.targetNodeId === node.id) ?? null)
    : null;
  const currentParentId = currentEdge?.sourceNodeId ?? null;

  // Parent options exclude the folder itself and its descendants (cycle guard;
  // the server would reject re-parenting a folder under its own subtree).
  const excluded = node
    ? new Set<string>([node.id, ...descendantIds(edges, node.id)])
    : new Set<string>();
  const parentOptions = nodes.filter((n) => !excluded.has(n.id));

  const [name, setName] = useState(node?.name ?? "");
  const nameValid =
    name.trim().length >= minNodeNameLength(name) && name.trim().length <= 40;
  const [description, setDescription] = useState(node?.description ?? "");
  const descriptionValid =
    isRoot ||
    description.replace(/\s/g, "").length >= minNodeDescriptionLength(description);
  const [draftPrompt, setDraftPrompt] = useState(node?.draftPrompt ?? "");
  // "" represents "None (not connected)".
  const [parentId, setParentId] = useState(currentParentId ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [moveToNodeId, setMoveToNodeId] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedDescription = description.trim();
    const trimmedDraftPrompt = draftPrompt.trim();
    const data: CreateTaxonomyNodeInput = {
      name: name.trim(),
      // Only include description if non-empty; omitting it on a root-node edit
      // leaves the existing DB value unchanged.
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      instructions: node?.instructions ?? null,
      draftPrompt: trimmedDraftPrompt || null,
      examples: node?.examples ?? [],
    };
    const chosenParentId = parentId === "" ? null : parentId;
    if (node && !isRoot && chosenParentId !== currentParentId) {
      onSubmit({
        data,
        parentId: chosenParentId,
        parentChange: {
          currentEdgeId: currentEdge?.id ?? null,
          newParentId: chosenParentId,
        },
      });
    } else {
      onSubmit({ data, parentId: chosenParentId });
    }
  }

  function handleDeleteClick() {
    if (classificationCount > 0) {
      setConfirmingDelete(true);
    } else {
      onDelete?.();
    }
  }

  return (
    <div className="panel-inner">
      <h2>{node ? <Trans>Edit Folder</Trans> : <Trans>Create Folder</Trans>}</h2>
      {error && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <form className="node-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">
            <Trans>Name</Trans> <span className="required">*</span>
          </label>
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={3}
            maxLength={40}
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            <Trans>Description</Trans>{!isRoot && <span className="required"> *</span>}
          </label>
          <textarea
            className="form-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required={!isRoot}
            maxLength={300}
            placeholder={_(msg`e.g. Invoices, receipts, payment confirmations, and billing questions from clients and vendors.`)}
          />
          {!isRoot && (
            <>
              <p style={{ fontSize: 11, color: "var(--color-muted)" }}>
                <Trans>
                  List the kinds of emails that belong here: senders, topics,
                  keywords. Aim for a full sentence.
                </Trans>
              </p>
              <DescriptionTips />
            </>
          )}
        </div>
        <div className="form-group">
          <label className="form-label"><Trans>Draft style guidance</Trans></label>
          <textarea
            className="form-textarea"
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            maxLength={500}
            placeholder={_(msg`e.g. Reply formally. Keep responses under 3 sentences.`)}
          />
          <p
            style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}
          >
            <Trans>
              Optional. Applied when generating draft replies for threads in this
              folder.
            </Trans>
          </p>
        </div>
        {!isRoot && (
          <div className="form-group">
            <label className="form-label"><Trans>Parent</Trans></label>
            <select
              className="form-select"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">{_(msg`None (not connected)`)}</option>
              {parentOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.isRoot ? _(msg`Inbox`) : n.name}
                  {n.isRoot ? _(msg` (Inbox)`) : ""}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>
              <Trans>
                Where this folder sits. Folders with no parent stay disconnected
                and are ignored until connected.
              </Trans>
            </p>
          </div>
        )}
        {confirmingDelete ? (
          <div style={{ marginTop: 16 }}>
            <div className="warning-box" style={{ marginBottom: 12 }}>
              <Plural
                value={classificationCount}
                one="Deleting this folder will leave # thread unsorted."
                other="Deleting this folder will leave # threads unsorted."
              />
            </div>
            {otherNodes.length > 0 && (
              <div className="form-group">
                <label className="form-label"><Trans>Move them to</Trans></label>
                <select
                  className="form-select"
                  value={moveToNodeId}
                  onChange={(e) => setMoveToNodeId(e.target.value)}
                >
                  <option value="">{_(msg`Leave unsorted`)}</option>
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-actions">
              <button
                className="btn-danger"
                type="button"
                onClick={() => onDelete?.(moveToNodeId || undefined)}
                disabled={submitting}
              >
                {submitting ? <Trans>Deleting…</Trans> : <Trans>Confirm Delete</Trans>}
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={submitting}
              >
                <Trans>Cancel</Trans>
              </button>
            </div>
          </div>
        ) : (
          <div className="form-actions">
            <button
              className="btn-primary"
              type="submit"
              disabled={submitting || !nameValid || !descriptionValid}
            >
              {submitting ? <Trans>Saving…</Trans> : node ? <Trans>Save</Trans> : <Trans>Create</Trans>}
            </button>
            <button className="btn-ghost" type="button" onClick={onCancel}>
              <Trans>Cancel</Trans>
            </button>
            {node &&
              !node.isRoot &&
              onDelete &&
              (deleteDisabledReason != null ? (
                <Tooltip content={deleteDisabledReason ?? ""}>
                  <span
                    style={{ display: "inline-block", cursor: "not-allowed" }}
                  >
                    <button
                      className="btn-danger"
                      type="button"
                      disabled
                      style={{ pointerEvents: "none" }}
                    >
                      <Trans>Delete</Trans>
                    </button>
                  </span>
                </Tooltip>
              ) : (
                <button
                  className="btn-danger"
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={submitting}
                >
                  <Trans>Delete</Trans>
                </button>
              ))}
          </div>
        )}
      </form>
    </div>
  );
}

// ─── EdgeForm ─────────────────────────────────────────────────────────────────

// Edit-only: opened by clicking a Path on the canvas. New Paths are created via
// the folder's Parent picker or by dragging a connection between folders.
function EdgeForm({
  edge,
  nodes,
  onSubmit,
  onCancel,
  onDelete,
  submitting,
  error,
}: {
  edge: TaxonomyEdge;
  nodes: TaxonomyNode[];
  onSubmit: (data: UpdateTaxonomyEdgeInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [sourceNodeId, setSourceNodeId] = useState(edge.sourceNodeId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(
      sourceNodeId !== edge.sourceNodeId
        ? ({ newSourceNodeId: sourceNodeId } satisfies UpdateTaxonomyEdgeInput)
        : ({} satisfies UpdateTaxonomyEdgeInput),
    );
  }

  return (
    <div className="panel-inner">
      <h2><Trans>Edit Path</Trans></h2>
      {error && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <form className="node-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label"><Trans>Parent</Trans></label>
            <select
              className="form-select"
              value={sourceNodeId}
              onChange={(e) => setSourceNodeId(e.target.value)}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label"><Trans>Child folder</Trans></label>
            <div
              className="form-select"
              style={{
                display: "flex",
                alignItems: "center",
                cursor: "default",
              }}
            >
              {nodeById(nodes, edge.targetNodeId)?.name ?? edge.targetNodeId}
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </button>
          {onDelete && (
            <button
              className="btn-danger"
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

// ─── Panel state ──────────────────────────────────────────────────────────────

type Panel =
  | { type: "none" }
  | { type: "create-node"; spawnPosition?: { x: number; y: number } }
  | { type: "edit-node"; node: TaxonomyNode }
  | { type: "edit-edge"; edge: TaxonomyEdge };

// ─── Snapshot diff applier ────────────────────────────────────────────────────

function nodesIdentical(a: TaxonomyNode, b: TaxonomyNode): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.instructions === b.instructions &&
    a.draftPrompt === b.draftPrompt &&
    a.positionX === b.positionX &&
    a.positionY === b.positionY &&
    JSON.stringify(a.examples) === JSON.stringify(b.examples)
  );
}

async function applySnapshotDiff(
  from: GraphSnapshot,
  to: GraphSnapshot,
  workspaceId: string,
): Promise<void> {
  if (snapshotsEqual(from, to)) return;

  const fromNodeMap = new Map(from.nodes.map((n) => [n.id, n]));
  const toNodeMap = new Map(to.nodes.map((n) => [n.id, n]));
  const fromEdgeMap = new Map(from.edges.map((e) => [e.id, e]));
  const toEdgeMap = new Map(to.edges.map((e) => [e.id, e]));

  // 1. Delete edges no longer in target (before deleting nodes)
  for (const id of fromEdgeMap.keys()) {
    if (!toEdgeMap.has(id)) {
      await deleteTaxonomyEdgeAction(workspaceId, id);
    }
  }

  // 2. Delete nodes no longer in target (root nodes are never deleted)
  for (const [id, fromNode] of fromNodeMap) {
    if (!toNodeMap.has(id) && !fromNode.isRoot) {
      await deleteTaxonomyNodeAction(workspaceId, id);
    }
  }

  // 3. Create nodes that exist in target but not in source
  for (const [id, toNode] of toNodeMap) {
    if (!fromNodeMap.has(id) && !toNode.isRoot) {
      await createTaxonomyNodeAction(workspaceId, {
        name: toNode.name,
        ...(toNode.description ? { description: toNode.description } : {}),
        instructions: toNode.instructions,
        draftPrompt: toNode.draftPrompt,
        examples: toNode.examples,
        positionX: toNode.positionX,
        positionY: toNode.positionY,
      });
    }
  }

  // 4. Create edges that exist in target but not in source
  for (const [id, toEdge] of toEdgeMap) {
    if (!fromEdgeMap.has(id)) {
      await createTaxonomyEdgeAction(workspaceId, {
        sourceNodeId: toEdge.sourceNodeId,
        targetNodeId: toEdge.targetNodeId,
      });
    }
  }

  // 5. Update nodes that exist in both but have changed fields
  for (const [id, toNode] of toNodeMap) {
    const fromNode = fromNodeMap.get(id);
    if (fromNode && !nodesIdentical(fromNode, toNode)) {
      await updateTaxonomyNodeAction(workspaceId, id, {
        name: toNode.name,
        ...(toNode.description ? { description: toNode.description } : {}),
        instructions: toNode.instructions,
        draftPrompt: toNode.draftPrompt,
        examples: toNode.examples,
        positionX: toNode.positionX,
        positionY: toNode.positionY,
      });
    }
  }
}

// ─── TaxonomyCanvasInner (must be inside ReactFlowProvider) ───────────────────

function TaxonomyCanvasInner({
  workspaceId,
  initialNodes,
  initialEdges,
  readOnly = false,
  gmailConnected = false,
}: {
  workspaceId: string;
  initialNodes: TaxonomyNode[];
  initialEdges: TaxonomyEdge[];
  readOnly?: boolean;
  gmailConnected?: boolean;
}) {
  const { _, i18n } = useLingui();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [dbNodes, setDbNodes] = useState<TaxonomyNode[]>(initialNodes);
  const [dbEdges, setDbEdges] = useState<TaxonomyEdge[]>(initialEdges);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>(
    toRFNodes(initialNodes, initialEdges),
  );
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(
    toRFEdges(initialEdges, initialNodes),
  );
  const [panel, setPanel] = useState<Panel>({ type: "none" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] =
    useState<TaxonomyTransferFile | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [selectedTemplateIdx, setSelectedTemplateIdx] = useState<number | null>(
    null,
  );
  const [generateOpen, setGenerateOpen] = useState(
    () => gmailConnected && searchParams.get("openGenerate") === "1",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const history = useTaxonomyHistory({
    nodes: initialNodes,
    edges: initialEdges,
  });
  const { screenToFlowPosition } = useReactFlow();
  const { resolved: resolvedTheme } = useTheme();

  // Edges bake in theme-resolved colors (ReactFlow markers can't read CSS vars
  // live), so rebuild them from the current data whenever the theme changes.
  useEffect(() => {
    setRfEdges(toRFEdges(dbEdges, dbNodes));
  }, [resolvedTheme, dbEdges, dbNodes, setRfEdges]);

  // Reset history when workspace changes (safety guard if component is reused).
  // Intentionally depends only on workspaceId — initialNodes/initialEdges are
  // the initial snapshot and must not trigger repeated resets on re-renders.
  useEffect(() => {
    history.reset({ nodes: initialNodes, edges: initialEdges });
  }, [workspaceId]);

  // Open the template picker or generate modal when navigated here with the
  // corresponding URL param (e.g. from UnroutedBanner on the emails page).
  useEffect(() => {
    const openTemplates = searchParams.get("openTemplates") === "1";
    const openGenerate = searchParams.get("openGenerate") === "1";
    if (!openTemplates && !openGenerate) return;
    if (openTemplates) {
      setSelectedTemplateIdx(null);
      setTemplatePickerOpen(true);
    }
    // Deep-linked generate with no inbox connected: send the user to the Gmail
    // OAuth flow rather than opening an empty generator that would wrongly
    // report "not enough variety" (matches GenerateFromInboxButton's click).
    if (openGenerate && !gmailConnected) {
      startGmailConnect(workspaceId);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("openTemplates");
    params.delete("openGenerate");
    const next = params.size > 0 ? `?${params.toString()}` : "";
    router.replace(`/plan${next}`, { scroll: false });
  }, []);

  const onCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      const target = event.target as Element;
      if (!target.classList.contains("react-flow__pane")) return;
      const spawnPosition = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      openPanel({ type: "create-node", spawnPosition });
    },
    [readOnly, screenToFlowPosition],
  );

  const refetch = useCallback(async () => {
    const [newNodes, newEdges] = await Promise.all([
      api.taxonomyNodes(workspaceId),
      api.taxonomyEdges(workspaceId),
    ]);
    setDbNodes(newNodes);
    setDbEdges(newEdges);
    setRfNodes(toRFNodes(newNodes, newEdges));
    setRfEdges(toRFEdges(newEdges, newNodes));
    return { nodes: newNodes, edges: newEdges };
  }, [workspaceId, setRfNodes, setRfEdges]);

  function openPanel(p: Panel) {
    setPanel(p);
    setFormError(null);
    setApiError(null);
  }

  // ─── Node drag stop: persist position ────────────────────────────────────

  const onNodeDragStop: OnNodeDrag<RFNode> = useCallback(
    async (_event, rfNode) => {
      if (readOnly) return;
      try {
        await updateTaxonomyNodeAction(workspaceId, rfNode.id, {
          positionX: Math.round(rfNode.position.x),
          positionY: Math.round(rfNode.position.y),
        });
        const updatedNodes = dbNodes.map((n) =>
          n.id === rfNode.id
            ? {
                ...n,
                positionX: rfNode.position.x,
                positionY: rfNode.position.y,
              }
            : n,
        );
        setDbNodes(updatedNodes);
        history.push({ nodes: updatedNodes, edges: dbEdges });
      } catch (err) {
        setApiError(
          err instanceof Error ? err.message : _(msg`Failed to save position`),
        );
      }
    },
    [workspaceId, dbNodes, dbEdges, history, _],
  );

  // ─── Connect nodes: create edge ───────────────────────────────────────────

  const onConnect: OnConnect = useCallback(
    async (connection: Connection) => {
      if (readOnly) return;
      if (!connection.source || !connection.target) return;
      if (dbNodes.find((n) => n.id === connection.target && n.isRoot)) return;
      try {
        await createTaxonomyEdgeAction(workspaceId, {
          sourceNodeId: connection.source,
          targetNodeId: connection.target,
        });
        const { nodes, edges } = await refetch();
        history.push({ nodes, edges });
      } catch (err) {
        setApiError(
          err instanceof Error ? err.message : _(msg`Failed to create path`),
        );
      }
    },
    [workspaceId, refetch, dbNodes, history, _],
  );

  // ─── Click node: open edit panel ──────────────────────────────────────────

  const onNodeClick: NodeMouseHandler<RFNode> = useCallback(
    (_event, rfNode) => {
      if (readOnly) return;
      const found = dbNodes.find((n) => n.id === rfNode.id);
      // The inbox root and the catch-all are fixed nodes and are not editable.
      if (found && !found.isRoot && !found.isCatchAll)
        openPanel({ type: "edit-node", node: found });
    },
    [dbNodes, readOnly],
  );

  // ─── Click edge: open edit panel ─────────────────────────────────────────

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, rfEdge) => {
      if (readOnly) return;
      const found = dbEdges.find((e) => e.id === rfEdge.id);
      if (found) openPanel({ type: "edit-edge", edge: found });
    },
    [dbEdges, readOnly],
  );

  // ─── Node mutations ───────────────────────────────────────────────────────

  async function handleCreateNode(submit: NodeFormSubmit) {
    setSubmitting(true);
    setFormError(null);
    const spawnPosition =
      panel.type === "create-node" ? panel.spawnPosition : undefined;
    try {
      // Two calls (create folder, then its Path): if the Path call fails the
      // folder is left disconnected (shown as Ignored), matching mobile.
      const created = await createTaxonomyNodeAction(workspaceId, {
        ...submit.data,
        ...(spawnPosition
          ? {
              positionX: Math.round(spawnPosition.x),
              positionY: Math.round(spawnPosition.y),
            }
          : {}),
      });
      if (submit.parentId) {
        await createTaxonomyEdgeAction(workspaceId, {
          sourceNodeId: submit.parentId,
          targetNodeId: created.id,
        });
      }
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to create folder`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateNode(nodeId: string, submit: NodeFormSubmit) {
    setSubmitting(true);
    setFormError(null);
    try {
      await updateTaxonomyNodeAction(workspaceId, nodeId, submit.data);
      const pc = submit.parentChange;
      if (pc) {
        if (pc.currentEdgeId && pc.newParentId) {
          await updateTaxonomyEdgeAction(workspaceId, pc.currentEdgeId, {
            newSourceNodeId: pc.newParentId,
          });
        } else if (pc.currentEdgeId && !pc.newParentId) {
          await deleteTaxonomyEdgeAction(workspaceId, pc.currentEdgeId);
        } else if (!pc.currentEdgeId && pc.newParentId) {
          await createTaxonomyEdgeAction(workspaceId, {
            sourceNodeId: pc.newParentId,
            targetNodeId: nodeId,
          });
        }
      }
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to update folder`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Edge mutations ───────────────────────────────────────────────────────

  async function handleUpdateEdge(
    edgeId: string,
    data: UpdateTaxonomyEdgeInput,
  ) {
    setSubmitting(true);
    setFormError(null);
    try {
      await updateTaxonomyEdgeAction(workspaceId, edgeId, data);
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to update path`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteNode(nodeId: string, moveToNodeId?: string) {
    setSubmitting(true);
    setFormError(null);
    try {
      await deleteTaxonomyNodeAction(workspaceId, nodeId, moveToNodeId);
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to delete folder`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteEdge(edgeId: string) {
    setSubmitting(true);
    setFormError(null);
    try {
      await deleteTaxonomyEdgeAction(workspaceId, edgeId);
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : _(msg`Failed to delete path`),
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Undo / Redo ──────────────────────────────────────────────────────────

  async function handleUndo() {
    if (!history.canUndo || !history.undoTarget) return;
    const from = history.present;
    const to = history.undoTarget;
    setPanel({ type: "none" });
    setSubmitting(true);
    setApiError(null);
    try {
      await applySnapshotDiff(from, to, workspaceId);
      history.undo();
      const { nodes, edges } = await refetch();
      history.sync({ nodes, edges });
    } catch (err) {
      setApiError(err instanceof Error ? err.message : _(msg`Failed to undo`));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRedo() {
    if (!history.canRedo || !history.redoTarget) return;
    const from = history.present;
    const to = history.redoTarget;
    setPanel({ type: "none" });
    setSubmitting(true);
    setApiError(null);
    try {
      await applySnapshotDiff(from, to, workspaceId);
      history.redo();
      const { nodes, edges } = await refetch();
      history.sync({ nodes, edges });
    } catch (err) {
      setApiError(err instanceof Error ? err.message : _(msg`Failed to redo`));
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  function handleExport() {
    const file = serializeTaxonomy(dbNodes, dbEdges);
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amarnai-taxonomy-${workspaceId}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  function handleImportClick() {
    setApiError(null);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    // Reset so the same file can be re-selected after an error
    e.target.value = "";
    if (!f) return;

    let raw: unknown;
    try {
      raw = JSON.parse(await f.text());
    } catch {
      setApiError(_(msg`Could not read file: invalid JSON.`));
      return;
    }

    const parsed = TaxonomyTransferFileSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const detail = first?.message ?? _(msg`unknown error`);
      setApiError(_(msg`Invalid taxonomy file: ${detail}`));
      return;
    }

    const validation = validateTaxonomyTransfer(parsed.data);
    if (!validation.ok) {
      setApiError(_(msg`Invalid taxonomy file: ${validation.error}`));
      return;
    }

    const currentlyRoutable = isTaxonomyRoutable(
      rfNodes.map((n) => ({ id: n.id, isRoot: n.data.node.isRoot, isCatchAll: n.data.node.isCatchAll })),
      rfEdges.map((e) => ({ sourceNodeId: e.source, targetNodeId: e.target })),
    );

    if (currentlyRoutable) {
      setPendingImportFile(validation.data);
      setImportConfirmOpen(true);
    } else {
      await executeImport(validation.data);
    }
  }

  async function executeImport(file: TaxonomyTransferFile) {
    setImportConfirmOpen(false);
    setPendingImportFile(null);
    setSubmitting(true);
    setApiError(null);
    try {
      await api.importTaxonomy(workspaceId, file);
      const { nodes, edges } = await refetch();
      history.reset({ nodes, edges });
    } catch (err) {
      setApiError(err instanceof Error ? err.message : _(msg`Import failed`));
    } finally {
      setSubmitting(false);
    }
  }

  // Templates are English data; localize names/descriptions (picker + every
  // folder) into the active locale once, then drive display, the "current"
  // match, and apply from this single array so persisted names match what the
  // user sees and what matchesTemplate compares against.
  const localizedTemplates = useMemo(
    () => TAXONOMY_TEMPLATES.map((t) => localizeTemplate(t, (s) => translateSource(i18n, s))),
    [i18n],
  );

  async function handleUseTemplate() {
    if (selectedTemplateIdx === null) return;
    const template = localizedTemplates[selectedTemplateIdx];
    if (!template) return;
    setTemplatePickerOpen(false);
    setSelectedTemplateIdx(null);
    if (taxonomyIsRoutable) {
      setPendingImportFile(template.file);
      setImportConfirmOpen(true);
    } else {
      await executeImport(template.file);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const taxonomyIsRoutable = isTaxonomyRoutable(
    rfNodes.map((n) => ({ id: n.id, isRoot: n.data.node.isRoot, isCatchAll: n.data.node.isCatchAll })),
    rfEdges.map((e) => ({ sourceNodeId: e.source, targetNodeId: e.target })),
  );

  const currentTemplateIdx = localizedTemplates.findIndex((t) =>
    matchesTemplate(dbNodes, dbEdges, t),
  );

  // The catch-all is not editable (its panel never opens), so the only
  // delete-disabled reason left here is having child folders.
  let nodeDeleteDisabledReason: string | null = null;
  if (panel.type === "edit-node") {
    const nodeHasOutgoingEdges = dbEdges.some(
      (e) => e.sourceNodeId === panel.node.id,
    );
    nodeDeleteDisabledReason = nodeHasOutgoingEdges
      ? _(msg`This folder has child folders. Remove their Paths first, then delete it.`)
      : null;
  }

  return (
    <div className="taxonomy-inner">
      {readOnly ? (
        <div className="taxonomy-readonly-banner">
          <Trans comment="“Plan” here is the email-sorting taxonomy, not a billing or subscription plan.">
            Plan is view-only. Only workspace admins can edit it.
          </Trans>
        </div>
      ) : (
        <div className="taxonomy-toolbar">
          <button
            className="btn-primary"
            onClick={() => openPanel({ type: "create-node" })}
          >
            <Trans>+ Add Folder</Trans>
          </button>
          <Tooltip content={_(msg`Undo`)}>
            <button
              className="btn-ghost"
              onClick={handleUndo}
              disabled={!history.canUndo || submitting}
            >
              ↶
            </button>
          </Tooltip>
          <Tooltip content={_(msg`Redo`)}>
            <button
              className="btn-ghost"
              onClick={handleRedo}
              disabled={!history.canRedo || submitting}
            >
              ↷
            </button>
          </Tooltip>
          <Tooltip
            content={
              taxonomyIsRoutable
                ? _(msg`Export plan`)
                : _(msg`Add at least 3 connected folders to export`)
            }
          >
            <button
              className="btn-ghost"
              onClick={handleExport}
              disabled={submitting || !taxonomyIsRoutable}
              aria-label={_(msg`Export plan`)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="M7 11V3M4 6L7 3L10 6M2 13H12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <Trans>Export</Trans>
            </button>
          </Tooltip>
          <Tooltip content={_(msg`Import plan (replaces current)`)}>
            <button
              className="btn-ghost"
              onClick={handleImportClick}
              disabled={submitting}
              aria-label={_(msg`Import plan`)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="M7 3V11M4 8L7 11L10 8M2 13H12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <Trans>Import</Trans>
            </button>
          </Tooltip>
          <Tooltip content={_(msg`Start from a template (replaces current)`)}>
            <button
              className="btn-ghost"
              onClick={() => {
                setSelectedTemplateIdx(null);
                setTemplatePickerOpen(true);
              }}
              disabled={submitting}
              aria-label={_(msg`Browse templates`)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="M7 1.5L8.2 5.8L12.5 7L8.2 8.2L7 12.5L5.8 8.2L1.5 7L5.8 5.8Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <Trans>Templates</Trans>
            </button>
          </Tooltip>
          <GenerateFromInboxButton
            workspaceId={workspaceId}
            disabled={submitting}
            gmailConnected={gmailConnected}
            onApply={executeImport}
            onUseTemplates={() => {
              setSelectedTemplateIdx(null);
              setTemplatePickerOpen(true);
            }}
            open={generateOpen}
            onOpenChange={setGenerateOpen}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={handleFileSelected}
          />
        </div>
      )}

      {apiError && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {apiError}
        </div>
      )}

      {(() => {
        // Count only folders actually reachable from the root — orphaned
        // nodes never receive threads, so they do not count toward the
        // routing threshold. Derived from live canvas state so the indicator
        // updates the moment an edge connects a node to the inbox.
        const routableCount = countRoutableNonRootNodes(
          rfNodes.map((n) => ({ id: n.id, isRoot: n.data.node.isRoot, isCatchAll: n.data.node.isCatchAll })),
          rfEdges.map((e) => ({
            sourceNodeId: e.source,
            targetNodeId: e.target,
          })),
        );
        if (routableCount >= TAXONOMY_MIN_NON_ROOT_NODES) return null;
        return (
          <div
            className="warning-box"
            style={{
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>
              <span className="em-pill accent" style={{ marginRight: 8 }}>
                {routableCount} / {TAXONOMY_MIN_NON_ROOT_NODES}
              </span>
              <Trans>
                {routableCount} of {TAXONOMY_MIN_NON_ROOT_NODES} folders
                connected to your inbox. Routing requires at least{" "}
                {TAXONOMY_MIN_NON_ROOT_NODES}.
              </Trans>
            </span>
            {!readOnly && (
              <button
                className="btn-primary"
                style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={() => {
                  if (!gmailConnected) {
                    startGmailConnect(workspaceId);
                    return;
                  }
                  setGenerateOpen(true);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path
                    d="M3 1.5L3.7 3.3L5.5 4L3.7 4.7L3 6.5L2.3 4.7L0.5 4L2.3 3.3ZM9.5 5L10.6 7.9L13.5 9L10.6 10.1L9.5 13L8.4 10.1L5.5 9L8.4 7.9Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
                <Trans>Generate from inbox</Trans>
              </button>
            )}
          </div>
        );
      })()}

      <div className="taxonomy-canvas-wrap">
        <div className="taxonomy-canvas" onDoubleClick={onCanvasDoubleClick}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            deleteKeyCode={null}
            zoomOnDoubleClick={false}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {panel.type !== "none" && (
          <div className="taxonomy-panel">
            <button
              className="taxonomy-panel-close"
              onClick={() => setPanel({ type: "none" })}
              aria-label={_(msg`Close panel`)}
            >
              ✕
            </button>
            {panel.type === "create-node" && (
              <NodeForm
                key="create-node"
                node={null}
                nodes={dbNodes}
                edges={dbEdges}
                onSubmit={handleCreateNode}
                onCancel={() => setPanel({ type: "none" })}
                submitting={submitting}
                error={formError}
              />
            )}
            {panel.type === "edit-node" && (
              <NodeForm
                key={panel.node.id}
                node={panel.node}
                nodes={dbNodes}
                edges={dbEdges}
                onSubmit={(submit) => handleUpdateNode(panel.node.id, submit)}
                onCancel={() => setPanel({ type: "none" })}
                onDelete={(moveToNodeId) =>
                  handleDeleteNode(panel.node.id, moveToNodeId)
                }
                deleteDisabledReason={nodeDeleteDisabledReason}
                classificationCount={panel.node.threadCount}
                otherNodes={dbNodes.filter(
                  (n) => n.id !== panel.node.id && !n.isRoot,
                )}
                submitting={submitting}
                error={formError}
              />
            )}
            {panel.type === "edit-edge" && (
              <EdgeForm
                key={panel.edge.id}
                edge={panel.edge}
                nodes={dbNodes}
                onSubmit={(data) => handleUpdateEdge(panel.edge.id, data)}
                onCancel={() => setPanel({ type: "none" })}
                onDelete={() => handleDeleteEdge(panel.edge.id)}
                submitting={submitting}
                error={formError}
              />
            )}
          </div>
        )}
      </div>

      {importConfirmOpen && pendingImportFile && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setImportConfirmOpen(false);
              setPendingImportFile(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setImportConfirmOpen(false);
              setPendingImportFile(null);
            }
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title"><Trans>Replace plan?</Trans></h2>
              <button
                className="modal-close"
                aria-label={_(msg`Cancel`)}
                onClick={() => {
                  setImportConfirmOpen(false);
                  setPendingImportFile(null);
                }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                <Trans>
                  Importing will replace your current plan with{" "}
                  <strong>{pendingImportFile.nodes.length} folders</strong> and{" "}
                  <strong>{pendingImportFile.edges.length} paths</strong> from the
                  file. Threads that were sorted into removed folders will
                  become unsorted. This cannot be undone.
                </Trans>
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="btn-ghost"
                onClick={() => {
                  setImportConfirmOpen(false);
                  setPendingImportFile(null);
                }}
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                className="btn-danger"
                onClick={() => executeImport(pendingImportFile)}
                disabled={submitting}
              >
                <Trans>Replace taxonomy</Trans>
              </button>
            </div>
          </div>
        </div>
      )}

      {templatePickerOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setTemplatePickerOpen(false);
              setSelectedTemplateIdx(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setTemplatePickerOpen(false);
              setSelectedTemplateIdx(null);
            }
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title">
                {taxonomyIsRoutable
                  ? <Trans>Replace with a template</Trans>
                  : <Trans>Start from a template</Trans>}
              </h2>
              <button
                className="modal-close"
                aria-label={_(msg`Cancel`)}
                onClick={() => {
                  setTemplatePickerOpen(false);
                  setSelectedTemplateIdx(null);
                }}
              >
                ✕
              </button>
            </div>
            <div
              className="modal-body"
              style={{ overflowY: "auto", maxHeight: "60vh" }}
            >
              <div className="option-cards">
                {localizedTemplates.map((template, idx) => {
                  const rootRef = template.file.nodes.find(
                    (n) => n.isRoot,
                  )?.ref;
                  const topLevelNames = template.file.edges
                    .filter((e) => e.sourceRef === rootRef)
                    .map(
                      (e) =>
                        template.file.nodes.find((n) => n.ref === e.targetRef)
                          ?.name,
                    )
                    .filter((n): n is string => !!n);
                  const isSelected = selectedTemplateIdx === idx;
                  const isCurrent = currentTemplateIdx === idx;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className={`option-card${isSelected ? " option-card--selected" : ""}`}
                      aria-pressed={isSelected}
                      disabled={isCurrent}
                      onClick={() => setSelectedTemplateIdx(idx)}
                    >
                      <span className="option-card-radio">
                        {isSelected && (
                          <span className="option-card-radio-dot" />
                        )}
                      </span>
                      <span className="option-card-text">
                        <span
                          className="option-card-label"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          {template.name}
                          {isCurrent && (
                            <span className="em-pill"><Trans>Current</Trans></span>
                          )}
                        </span>
                        <span className="option-card-desc">
                          {template.description}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 4,
                            marginTop: 6,
                          }}
                        >
                          {topLevelNames.map((name) => (
                            <span key={name} className="em-pill">
                              {name}
                            </span>
                          ))}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-ghost"
                onClick={() => {
                  setTemplatePickerOpen(false);
                  setSelectedTemplateIdx(null);
                }}
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                className="btn-primary"
                onClick={handleUseTemplate}
                disabled={
                  selectedTemplateIdx === null ||
                  selectedTemplateIdx === currentTemplateIdx ||
                  submitting
                }
              >
                <Trans>Use template</Trans>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TaxonomyClient ───────────────────────────────────────────────────────────

export function TaxonomyClient({
  workspaceId,
  nodes,
  edges,
  readOnly = false,
  gmailConnected = false,
}: {
  workspaceId: string;
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
  readOnly?: boolean;
  gmailConnected?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <TaxonomyCanvasInner
        workspaceId={workspaceId}
        initialNodes={nodes}
        initialEdges={edges}
        readOnly={readOnly}
        gmailConnected={gmailConnected}
      />
    </ReactFlowProvider>
  );
}
