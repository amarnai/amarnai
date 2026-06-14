"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
import { tokens } from "@/lib/tokens";
import {
  api,
  type TaxonomyNode,
  type TaxonomyEdge,
  type CreateTaxonomyNodeInput,
  type UpdateTaxonomyNodeInput,
  type CreateTaxonomyEdgeInput,
  type UpdateTaxonomyEdgeInput,
} from "@/lib/api";
import {
  createTaxonomyNodeAction,
  updateTaxonomyNodeAction,
  deleteTaxonomyNodeAction,
  createTaxonomyEdgeAction,
  updateTaxonomyEdgeAction,
  deleteTaxonomyEdgeAction,
  importTaxonomyAction,
} from "@/actions/taxonomy";
import {
  computeIgnoredReasons,
  type IgnoredReason,
} from "./taxonomyUtils";
import { TAXONOMY_TEMPLATES, type TaxonomyTemplate } from "./taxonomyTemplates";
import {
  useTaxonomyHistory,
  snapshotsEqual,
  type GraphSnapshot,
} from "./useTaxonomyHistory";
import { TaxonomyNodeCardBase } from "@amarnai/ui/taxonomy";
import { Tooltip } from "@amarnai/ui";
import {
  TAXONOMY_MIN_NON_ROOT_NODES,
  countRoutableNonRootNodes,
  isTaxonomyRoutable,
  serializeTaxonomy,
  TaxonomyTransferFileSchema,
  validateTaxonomyTransfer,
  type TaxonomyTransferFile,
} from "@amarnai/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeById(nodes: TaxonomyNode[], id: string): TaxonomyNode | undefined {
  return nodes.find((n) => n.id === id);
}

function matchesTemplate(
  dbNodes: TaxonomyNode[],
  dbEdges: TaxonomyEdge[],
  template: TaxonomyTemplate
): boolean {
  const { nodes: tNodes, edges: tEdges } = template.file;
  if (dbNodes.length !== tNodes.length || dbEdges.length !== tEdges.length) return false;

  const dbNames = dbNodes.map((n) => n.name).sort();
  const tNames = tNodes.map((n) => n.name).sort();
  if (dbNames.some((n, i) => n !== tNames[i])) return false;

  const dbIdToName = new Map(dbNodes.map((n) => [n.id, n.name]));
  const tRefToName = new Map(tNodes.map((n) => [n.ref, n.name]));
  const dbEdgeSet = new Set(
    dbEdges.map((e) => `${dbIdToName.get(e.sourceNodeId)}→${dbIdToName.get(e.targetNodeId)}`)
  );
  return tEdges.every(
    (e) => dbEdgeSet.has(`${tRefToName.get(e.sourceRef)}→${tRefToName.get(e.targetRef)}`)
  );
}

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

function toRFEdge(e: TaxonomyEdge, ignoredReasonsMap: Map<string, IgnoredReason>): Edge {
  const targetIgnored = ignoredReasonsMap.has(e.targetNodeId);
  return {
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: "taxonomy-edge",
    markerEnd: { type: MarkerType.ArrowClosed, color: targetIgnored ? tokens.accent : tokens.edgeDefault },
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

  const targetIgnored = (data as RFEdgeData | undefined)?.targetIgnored ?? false;
  const isWarning = targetIgnored;
  const strokeColor = isWarning && selected ? tokens.accentDim : selected ? tokens.primary : isWarning ? tokens.accent : tokens.edgeDefault;

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

// ─── NodeForm ─────────────────────────────────────────────────────────────────

function NodeForm({
  node,
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
  onSubmit: (data: CreateTaxonomyNodeInput) => void;
  onCancel: () => void;
  onDelete?: (moveToNodeId?: string) => void;
  deleteDisabledReason?: string | null;
  classificationCount?: number;
  otherNodes?: Pick<TaxonomyNode, "id" | "name">[];
  submitting: boolean;
  error: string | null;
}) {
  const isRoot = node?.isRoot ?? false;

  const [name, setName] = useState(node?.name ?? "");
  const [description, setDescription] = useState(node?.description ?? "");
  const descriptionValid = isRoot || description.replace(/\s/g, "").length >= 30;
  const [draftPrompt, setDraftPrompt] = useState(node?.draftPrompt ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [moveToNodeId, setMoveToNodeId] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedDescription = description.trim();
    const trimmedDraftPrompt = draftPrompt.trim();
    onSubmit({
      name: name.trim(),
      // Only include description if non-empty; omitting it on a root-node edit
      // leaves the existing DB value unchanged.
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      instructions: node?.instructions ?? null,
      draftPrompt: trimmedDraftPrompt || null,
      examples: node?.examples ?? [],
    });
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
      <h2>{node ? "Edit Node" : "Create Node"}</h2>
      {error && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <form className="node-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">
            Name <span className="required">*</span>
          </label>
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={3}
            maxLength={60}
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            Description{!isRoot && <span className="required"> *</span>}
          </label>
          <textarea
            className="form-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required={!isRoot}
            maxLength={300}
          />
          {!isRoot && (
            <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>
              At least 30 non-whitespace characters. Descriptions improve AI sorting quality.
            </p>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Draft style guidance</label>
          <textarea
            className="form-textarea"
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            maxLength={500}
            placeholder="e.g. Reply formally. Keep responses under 3 sentences."
          />
          <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>
            Optional. Applied when generating draft replies for threads in this category.
          </p>
        </div>
        {confirmingDelete ? (
          <div style={{ marginTop: 16 }}>
            <div className="warning-box" style={{ marginBottom: 12 }}>
              Deleting this node will leave {classificationCount} thread{classificationCount !== 1 ? "s" : ""} unsorted.
            </div>
            {otherNodes.length > 0 && (
              <div className="form-group">
                <label className="form-label">Move them to</label>
                <select
                  className="form-select"
                  value={moveToNodeId}
                  onChange={(e) => setMoveToNodeId(e.target.value)}
                >
                  <option value="">Leave unsorted</option>
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
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
                {submitting ? "Deleting…" : "Confirm Delete"}
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="form-actions">
            <button className="btn-primary" type="submit" disabled={submitting || !descriptionValid}>
              {submitting ? "Saving…" : node ? "Save" : "Create"}
            </button>
            <button className="btn-ghost" type="button" onClick={onCancel}>
              Cancel
            </button>
            {node && !node.isRoot && onDelete && (
              deleteDisabledReason != null ? (
                <Tooltip content={deleteDisabledReason ?? ""}>
                  <span style={{ display: "inline-block", cursor: "not-allowed" }}>
                    <button
                      className="btn-danger"
                      type="button"
                      disabled
                      style={{ pointerEvents: "none" }}
                    >
                      Delete
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
                  Delete
                </button>
              )
            )}
          </div>
        )}
      </form>
    </div>
  );
}

// ─── EdgeForm ─────────────────────────────────────────────────────────────────

function EdgeForm({
  edge,
  nodes,
  onSubmit,
  onCancel,
  onDelete,
  submitting,
  error,
}: {
  edge: TaxonomyEdge | null;
  nodes: TaxonomyNode[];
  onSubmit: (data: CreateTaxonomyEdgeInput | UpdateTaxonomyEdgeInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const nonRootNodes = nodes.filter((n) => !n.isRoot);

  const [sourceNodeId, setSourceNodeId] = useState(edge?.sourceNodeId ?? "");
  const [targetNodeId, setTargetNodeId] = useState(edge?.targetNodeId ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (edge) {
      onSubmit(
        sourceNodeId !== edge.sourceNodeId
          ? ({ newSourceNodeId: sourceNodeId } satisfies UpdateTaxonomyEdgeInput)
          : ({} satisfies UpdateTaxonomyEdgeInput)
      );
    } else {
      onSubmit({
        sourceNodeId,
        targetNodeId,
      } satisfies CreateTaxonomyEdgeInput);
    }
  }

  return (
    <div className="panel-inner">
      <h2>{edge ? "Edit Edge" : "Create Edge"}</h2>
      {error && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <form className="node-form" onSubmit={handleSubmit}>
        {!edge ? (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                From <span className="required">*</span>
              </label>
              <select
                className="form-select"
                value={sourceNodeId}
                onChange={(e) => setSourceNodeId(e.target.value)}
                required
              >
                <option value="">Select source</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                To <span className="required">*</span>
              </label>
              <select
                className="form-select"
                value={targetNodeId}
                onChange={(e) => setTargetNodeId(e.target.value)}
                required
              >
                <option value="">Select target</option>
                {nonRootNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">From (parent)</label>
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
              <label className="form-label">To</label>
              <div className="form-select" style={{ display: "flex", alignItems: "center", cursor: "default" }}>
                {nodeById(nodes, edge.targetNodeId)?.name ?? edge.targetNodeId}
              </div>
            </div>
          </div>
        )}
        <div className="form-actions">
          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : edge ? "Save" : "Create"}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          {edge && onDelete && (
            <button
              className="btn-danger"
              type="button"
              onClick={onDelete}
              disabled={submitting}
            >
              Delete
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
  | { type: "create-edge" }
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
}: {
  workspaceId: string;
  initialNodes: TaxonomyNode[];
  initialEdges: TaxonomyEdge[];
  readOnly?: boolean;
}) {
  const [dbNodes, setDbNodes] = useState<TaxonomyNode[]>(initialNodes);
  const [dbEdges, setDbEdges] = useState<TaxonomyEdge[]>(initialEdges);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>(
    toRFNodes(initialNodes, initialEdges)
  );
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(
    toRFEdges(initialEdges, initialNodes)
  );
  const [panel, setPanel] = useState<Panel>({ type: "none" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<TaxonomyTransferFile | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [selectedTemplateIdx, setSelectedTemplateIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const history = useTaxonomyHistory({ nodes: initialNodes, edges: initialEdges });
  const { screenToFlowPosition } = useReactFlow();

  // Reset history when workspace changes (safety guard if component is reused).
  // Intentionally depends only on workspaceId — initialNodes/initialEdges are
  // the initial snapshot and must not trigger repeated resets on re-renders.
  useEffect(() => {
    history.reset({ nodes: initialNodes, edges: initialEdges });
  }, [workspaceId]);

  const onCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      const target = event.target as Element;
      if (!target.classList.contains("react-flow__pane")) return;
      const spawnPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      openPanel({ type: "create-node", spawnPosition });
    },
    [readOnly, screenToFlowPosition]
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
            ? { ...n, positionX: rfNode.position.x, positionY: rfNode.position.y }
            : n
        );
        setDbNodes(updatedNodes);
        history.push({ nodes: updatedNodes, edges: dbEdges });
      } catch (err) {
        setApiError(err instanceof Error ? err.message : "Failed to save position");
      }
    },
    [workspaceId, dbNodes, dbEdges, history]
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
        setApiError(err instanceof Error ? err.message : "Failed to create edge");
      }
    },
    [workspaceId, refetch, dbNodes, history]
  );

  // ─── Click node: open edit panel ──────────────────────────────────────────

  const onNodeClick: NodeMouseHandler<RFNode> = useCallback(
    (_event, rfNode) => {
      if (readOnly) return;
      const found = dbNodes.find((n) => n.id === rfNode.id);
      if (found && !found.isRoot) openPanel({ type: "edit-node", node: found });
    },
    [dbNodes, readOnly]
  );

  // ─── Click edge: open edit panel ─────────────────────────────────────────

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, rfEdge) => {
      if (readOnly) return;
      const found = dbEdges.find((e) => e.id === rfEdge.id);
      if (found) openPanel({ type: "edit-edge", edge: found });
    },
    [dbEdges, readOnly]
  );

  // ─── Node mutations ───────────────────────────────────────────────────────

  async function handleCreateNode(data: CreateTaxonomyNodeInput) {
    setSubmitting(true);
    setFormError(null);
    const spawnPosition = panel.type === "create-node" ? panel.spawnPosition : undefined;
    try {
      await createTaxonomyNodeAction(workspaceId, {
        ...data,
        ...(spawnPosition
          ? { positionX: Math.round(spawnPosition.x), positionY: Math.round(spawnPosition.y) }
          : {}),
      });
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create node");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateNode(nodeId: string, data: UpdateTaxonomyNodeInput) {
    setSubmitting(true);
    setFormError(null);
    try {
      await updateTaxonomyNodeAction(workspaceId, nodeId, data);
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update node");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Edge mutations ───────────────────────────────────────────────────────

  async function handleCreateEdge(data: CreateTaxonomyEdgeInput | UpdateTaxonomyEdgeInput) {
    setSubmitting(true);
    setFormError(null);
    try {
      await createTaxonomyEdgeAction(workspaceId, data as CreateTaxonomyEdgeInput);
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create edge");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateEdge(edgeId: string, data: CreateTaxonomyEdgeInput | UpdateTaxonomyEdgeInput) {
    setSubmitting(true);
    setFormError(null);
    try {
      await updateTaxonomyEdgeAction(workspaceId, edgeId, data as UpdateTaxonomyEdgeInput);
      const { nodes, edges } = await refetch();
      history.push({ nodes, edges });
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update edge");
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
      setFormError(err instanceof Error ? err.message : "Failed to delete node");
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
      setFormError(err instanceof Error ? err.message : "Failed to delete edge");
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
      setApiError(err instanceof Error ? err.message : "Failed to undo");
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
      setApiError(err instanceof Error ? err.message : "Failed to redo");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  function handleExport() {
    const file = serializeTaxonomy(dbNodes, dbEdges);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
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
      setApiError("Could not read file: invalid JSON.");
      return;
    }

    const parsed = TaxonomyTransferFileSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setApiError(`Invalid taxonomy file: ${first?.message ?? "unknown error"}`);
      return;
    }

    const validation = validateTaxonomyTransfer(parsed.data);
    if (!validation.ok) {
      setApiError(`Invalid taxonomy file: ${validation.error}`);
      return;
    }

    const currentlyRoutable = isTaxonomyRoutable(
      rfNodes.map((n) => ({ id: n.id, isRoot: n.data.node.isRoot })),
      rfEdges.map((e) => ({ sourceNodeId: e.source, targetNodeId: e.target }))
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
      await importTaxonomyAction(workspaceId, file);
      const { nodes, edges } = await refetch();
      history.reset({ nodes, edges });
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUseTemplate() {
    if (selectedTemplateIdx === null) return;
    const template = TAXONOMY_TEMPLATES[selectedTemplateIdx];
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
    rfNodes.map((n) => ({ id: n.id, isRoot: n.data.node.isRoot })),
    rfEdges.map((e) => ({ sourceNodeId: e.source, targetNodeId: e.target }))
  );

  const currentTemplateIdx = TAXONOMY_TEMPLATES.findIndex((t) =>
    matchesTemplate(dbNodes, dbEdges, t)
  );

  let nodeDeleteDisabledReason: string | null = null;
  if (panel.type === "edit-node") {
    const nodeHasOutgoingEdges = dbEdges.some(
      (e) => e.sourceNodeId === panel.node.id
    );
    nodeDeleteDisabledReason = nodeHasOutgoingEdges
      ? "This node has child connections. Removing it would restructure the graph unexpectedly — delete its outgoing edges first."
      : null;
  }

  return (
    <div className="taxonomy-inner">
      {readOnly ? (
        <div className="taxonomy-readonly-banner">
          Taxonomy is view-only. Only workspace admins can edit it.
        </div>
      ) : (
        <div className="taxonomy-toolbar">
          <button
            className="btn-primary"
            onClick={() => openPanel({ type: "create-node" })}
          >
            + Add Node
          </button>
          <button
            className="btn-ghost"
            onClick={() => openPanel({ type: "create-edge" })}
          >
            + Create Edge
          </button>
          <Tooltip content="Undo">
            <button
              className="btn-ghost"
              onClick={handleUndo}
              disabled={!history.canUndo || submitting}
            >
              ↶
            </button>
          </Tooltip>
          <Tooltip content="Redo">
            <button
              className="btn-ghost"
              onClick={handleRedo}
              disabled={!history.canRedo || submitting}
            >
              ↷
            </button>
          </Tooltip>
          <Tooltip content={taxonomyIsRoutable ? "Export taxonomy" : "Add at least 3 connected categories to export"}>
            <button
              className="btn-ghost"
              onClick={handleExport}
              disabled={submitting || !taxonomyIsRoutable}
              aria-label="Export taxonomy"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M7 11V3M4 6L7 3L10 6M2 13H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Export
            </button>
          </Tooltip>
          <Tooltip content="Import taxonomy (replaces current)">
            <button
              className="btn-ghost"
              onClick={handleImportClick}
              disabled={submitting}
              aria-label="Import taxonomy"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M7 3V11M4 8L7 11L10 8M2 13H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Import
            </button>
          </Tooltip>
          <Tooltip content="Start from a template (replaces current)">
            <button
              className="btn-ghost"
              onClick={() => {
                setSelectedTemplateIdx(null);
                setTemplatePickerOpen(true);
              }}
              disabled={submitting}
              aria-label="Browse templates"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M7 1.5L8.2 5.8L12.5 7L8.2 8.2L7 12.5L5.8 8.2L1.5 7L5.8 5.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              Templates
            </button>
          </Tooltip>
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
        // Count only categories actually reachable from the root — orphaned
        // nodes never receive threads, so they do not count toward the
        // routing threshold. Derived from live canvas state so the indicator
        // updates the moment an edge connects a node to the inbox.
        const routableCount = countRoutableNonRootNodes(
          rfNodes.map((n) => ({ id: n.id, isRoot: n.data.node.isRoot })),
          rfEdges.map((e) => ({ sourceNodeId: e.source, targetNodeId: e.target }))
        );
        if (routableCount >= TAXONOMY_MIN_NON_ROOT_NODES) return null;
        return (
          <div className="warning-box" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span>
              <span className="em-pill accent" style={{ marginRight: 8 }}>
                {routableCount} / {TAXONOMY_MIN_NON_ROOT_NODES}
              </span>
              {routableCount} of {TAXONOMY_MIN_NON_ROOT_NODES} categories connected to your inbox. Routing requires at least {TAXONOMY_MIN_NON_ROOT_NODES}.
            </span>
            {!readOnly && (
              <button
                className="btn-primary"
                style={{ flexShrink: 0 }}
                onClick={() => {
                  setSelectedTemplateIdx(null);
                  setTemplatePickerOpen(true);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M7 1.5L8.2 5.8L12.5 7L8.2 8.2L7 12.5L5.8 8.2L1.5 7L5.8 5.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                Use a template
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
              aria-label="Close panel"
            >
              ✕
            </button>
            {panel.type === "create-node" && (
              <NodeForm
                key="create-node"
                node={null}
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
                onSubmit={(data) => handleUpdateNode(panel.node.id, data)}
                onCancel={() => setPanel({ type: "none" })}
                onDelete={(moveToNodeId) => handleDeleteNode(panel.node.id, moveToNodeId)}
                deleteDisabledReason={nodeDeleteDisabledReason}
                classificationCount={panel.node.threadCount}
                otherNodes={dbNodes.filter((n) => n.id !== panel.node.id && !n.isRoot)}
                submitting={submitting}
                error={formError}
              />
            )}
            {panel.type === "create-edge" && (
              <EdgeForm
                key="create-edge"
                edge={null}
                nodes={dbNodes}
                onSubmit={handleCreateEdge}
                onCancel={() => setPanel({ type: "none" })}
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
              <h2 className="modal-title">Replace taxonomy?</h2>
              <button
                className="modal-close"
                aria-label="Cancel"
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
                Importing will replace your current taxonomy with{" "}
                <strong>{pendingImportFile.nodes.length} nodes</strong> and{" "}
                <strong>{pendingImportFile.edges.length} edges</strong> from the file.
                Threads that were sorted into removed categories will become unsorted.
                This cannot be undone.
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
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={() => executeImport(pendingImportFile)}
                disabled={submitting}
              >
                Replace taxonomy
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
              <h2 className="modal-title">{taxonomyIsRoutable ? "Replace with a template" : "Start from a template"}</h2>
              <button
                className="modal-close"
                aria-label="Cancel"
                onClick={() => {
                  setTemplatePickerOpen(false);
                  setSelectedTemplateIdx(null);
                }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ overflowY: "auto", maxHeight: "60vh" }}>
              <div className="option-cards">
                {TAXONOMY_TEMPLATES.map((template, idx) => {
                  const rootRef = template.file.nodes.find((n) => n.isRoot)?.ref;
                  const topLevelNames = template.file.edges
                    .filter((e) => e.sourceRef === rootRef)
                    .map((e) => template.file.nodes.find((n) => n.ref === e.targetRef)?.name)
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
                        {isSelected && <span className="option-card-radio-dot" />}
                      </span>
                      <span className="option-card-text">
                        <span className="option-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {template.name}
                          {isCurrent && <span className="em-pill">Current</span>}
                        </span>
                        <span className="option-card-desc">{template.description}</span>
                        <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          {topLevelNames.map((name) => (
                            <span key={name} className="em-pill">{name}</span>
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
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleUseTemplate}
                disabled={selectedTemplateIdx === null || selectedTemplateIdx === currentTemplateIdx || submitting}
              >
                Use template
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
}: {
  workspaceId: string;
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
  readOnly?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <TaxonomyCanvasInner
        workspaceId={workspaceId}
        initialNodes={nodes}
        initialEdges={edges}
        readOnly={readOnly}
      />
    </ReactFlowProvider>
  );
}
