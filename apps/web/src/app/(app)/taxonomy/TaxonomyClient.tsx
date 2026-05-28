"use client";

import { useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
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
    markerEnd: { type: MarkerType.Arrow, color: targetIgnored ? tokens.accent : tokens.edgeDefault },
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
  const ignored = ignoredReason !== null;

  const tooltipText = ignoredReason === "no-incoming"
    ? "This node has no incoming edge and will not be used."
    : undefined;

  return (
    <div
      className={`taxonomy-node-card${selected ? " selected" : ""}${ignored ? " unreachable" : ""}`}
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
  submitting,
  error,
}: {
  node: TaxonomyNode | null;
  onSubmit: (data: CreateTaxonomyNodeInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleteDisabledReason?: string | null;
  submitting: boolean;
  error: string | null;
}) {
  const isRoot = node?.isRoot ?? false;

  const [name, setName] = useState(node?.name ?? "");
  const [description, setDescription] = useState(node?.description ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedDescription = description.trim();
    onSubmit({
      name: name.trim(),
      // Only include description if non-empty; omitting it on a root-node edit
      // leaves the existing DB value unchanged.
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      instructions: node?.instructions ?? null,
      examples: node?.examples ?? [],
    });
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
        <div className="form-actions">
          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : node ? "Save" : "Create"}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          {node && !node.isRoot && onDelete && (
            deleteDisabledReason != null ? (
              <span title={deleteDisabledReason} style={{ display: "inline-block", cursor: "not-allowed" }}>
                <button
                  className="btn-danger"
                  type="button"
                  disabled
                  style={{ pointerEvents: "none" }}
                >
                  Delete
                </button>
              </span>
            ) : (
              <button
                className="btn-danger"
                type="button"
                onClick={onDelete}
                disabled={submitting}
              >
                Delete
              </button>
            )
          )}
        </div>
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
  | { type: "create-node" }
  | { type: "edit-node"; node: TaxonomyNode }
  | { type: "create-edge" }
  | { type: "edit-edge"; edge: TaxonomyEdge };

// ─── Snapshot diff applier ────────────────────────────────────────────────────

function nodesIdentical(a: TaxonomyNode, b: TaxonomyNode): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.instructions === b.instructions &&
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
}: {
  workspaceId: string;
  initialNodes: TaxonomyNode[];
  initialEdges: TaxonomyEdge[];
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

  // Reset history when workspace changes (safety guard if component is reused).
  // Intentionally depends only on workspaceId — initialNodes/initialEdges are
  // the initial snapshot and must not trigger repeated resets on re-renders.
  useEffect(() => {
    history.reset({ nodes: initialNodes, edges: initialEdges });
  }, [workspaceId]);

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
      const found = dbNodes.find((n) => n.id === rfNode.id);
      if (found && !found.isRoot) openPanel({ type: "edit-node", node: found });
    },
    [dbNodes]
  );

  // ─── Click edge: open edit panel ─────────────────────────────────────────

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, rfEdge) => {
      const found = dbEdges.find((e) => e.id === rfEdge.id);
      if (found) openPanel({ type: "edit-edge", edge: found });
    },
    [dbEdges]
  );

  // ─── Node mutations ───────────────────────────────────────────────────────

  async function handleCreateNode(data: CreateTaxonomyNodeInput) {
    setSubmitting(true);
    setFormError(null);
    try {
      await createTaxonomyNodeAction(workspaceId, data);
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

  async function handleDeleteNode(nodeId: string) {
    setSubmitting(true);
    setFormError(null);
    try {
      await deleteTaxonomyNodeAction(workspaceId, nodeId);
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
    const nodeHasEdges = dbEdges.some(
      (e) => e.sourceNodeId === panel.node.id || e.targetNodeId === panel.node.id
    );
    nodeDeleteDisabledReason = nodeHasEdges
      ? "Remove connected edges before deleting this node."
      : null;
  }

  return (
    <div>
      <div className="taxonomy-toolbar">
        <button
          className="btn-primary"
          onClick={() => openPanel({ type: "create-node" })}
        >
          + Create Node
        </button>
        <button
          className="btn-ghost"
          onClick={() => openPanel({ type: "create-edge" })}
        >
          + Create Edge
        </button>
        <button
          className="btn-ghost"
          onClick={handleUndo}
          disabled={!history.canUndo || submitting}
          title="Undo"
        >
          Undo
        </button>
        <button
          className="btn-ghost"
          onClick={handleRedo}
          disabled={!history.canRedo || submitting}
          title="Redo"
        >
          Redo
        </button>
        {panel.type !== "none" && (
          <button className="btn-ghost" onClick={() => setPanel({ type: "none" })}>
            Close panel
          </button>
        )}
      </div>

      {apiError && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {apiError}
        </div>
      )}

      <div className="taxonomy-canvas-wrap">
        <div className="taxonomy-canvas">
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
            fitView
            fitViewOptions={{ padding: 0.3 }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {panel.type !== "none" && (
          <div className="taxonomy-panel">
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
                onDelete={() => handleDeleteNode(panel.node.id)}
                deleteDisabledReason={nodeDeleteDisabledReason}
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
}: {
  workspaceId: string;
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
}) {
  return (
    <ReactFlowProvider>
      <TaxonomyCanvasInner
        workspaceId={workspaceId}
        initialNodes={nodes}
        initialEdges={edges}
      />
    </ReactFlowProvider>
  );
}
