"use client";

import { useState, useCallback, useEffect } from "react";
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
} from "@/actions/taxonomy";
import {
  computeIgnoredReasons,
  type IgnoredReason,
} from "./taxonomyUtils";
import {
  useTaxonomyHistory,
  snapshotsEqual,
  type GraphSnapshot,
} from "./useTaxonomyHistory";
import { TaxonomyNodeCardBase } from "@amarnai/ui/taxonomy";
import { Tooltip } from "@amarnai/ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeById(nodes: TaxonomyNode[], id: string): TaxonomyNode | undefined {
  return nodes.find((n) => n.id === id);
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
  const title = ignoredReason === "no-incoming"
    ? "This node has no incoming edge and will not be used."
    : undefined;

  return (
    <TaxonomyNodeCardBase
      name={node.name}
      {...(node.description ? { description: node.description } : {})}
      isRoot={node.isRoot}
      ignored={ignoredReason !== null}
      selected={selected}
      {...(title ? { title } : {})}
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
            <button className="btn-primary" type="submit" disabled={submitting}>
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
      onSubmit({} satisfies UpdateTaxonomyEdgeInput);
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
          <div className="node-meta-row" style={{ marginBottom: 4 }}>
            <span className="node-meta-item">
              {nodeById(nodes, edge.sourceNodeId)?.name ?? edge.sourceNodeId}
              {" → "}
              {nodeById(nodes, edge.targetNodeId)?.name ?? edge.targetNodeId}
            </span>
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

  // ─── Render ───────────────────────────────────────────────────────────────

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
        </div>
      )}

      {apiError && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {apiError}
        </div>
      )}

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
