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
  EdgeLabelRenderer,
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
  isMissingSortingQuestion,
  computeIgnoredReasons,
  computeNodeValidityWarnings,
  type IgnoredReason,
  type NodeValidityWarning,
} from "./taxonomyUtils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeById(nodes: TaxonomyNode[], id: string): TaxonomyNode | undefined {
  return nodes.find((n) => n.id === id);
}

function formatEdgeLabel(q: string | null | undefined): string {
  if (isMissingSortingQuestion(q)) return "Missing sorting question";
  return q!.trim();
}

// ─── React Flow node/edge converters ──────────────────────────────────────────

type RFNodeData = { node: TaxonomyNode; ignoredReason: IgnoredReason; validityWarnings: NodeValidityWarning[] };
type RFNode = Node<RFNodeData, "taxonomy">;

function toRFNode(n: TaxonomyNode, ignoredReason: IgnoredReason, validityWarnings: NodeValidityWarning[]): RFNode {
  return {
    id: n.id,
    type: "taxonomy",
    position: { x: n.positionX, y: n.positionY },
    data: { node: n, ignoredReason, validityWarnings },
  };
}

function toRFNodes(nodes: TaxonomyNode[], edges: TaxonomyEdge[]): RFNode[] {
  const ignoredMap = computeIgnoredReasons(nodes, edges);
  const warningsMap = computeNodeValidityWarnings(nodes, edges);
  return nodes.map((n) => toRFNode(n, ignoredMap.get(n.id) ?? null, warningsMap.get(n.id) ?? []));
}

function toRFEdge(e: TaxonomyEdge, ignoredReasonsMap: Map<string, IgnoredReason>): Edge {
  const missing = isMissingSortingQuestion(e.sortingQuestion);
  const targetIgnored = ignoredReasonsMap.has(e.targetNodeId);
  const isWarning = missing || targetIgnored;
  return {
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: "taxonomy-edge",
    markerEnd: { type: MarkerType.ArrowClosed, color: isWarning ? tokens.accent : tokens.edgeDefault },
    data: { sortingQuestion: e.sortingQuestion, targetIgnored },
  };
}

function toRFEdges(edges: TaxonomyEdge[], nodes: TaxonomyNode[]): Edge[] {
  const ignoredMap = computeIgnoredReasons(nodes, edges);
  return edges.map((e) => toRFEdge(e, ignoredMap));
}

// ─── Custom node component ────────────────────────────────────────────────────

function TaxonomyNodeCard({ data, selected }: NodeProps<RFNode>) {
  const { node, ignoredReason, validityWarnings } = data;
  const ignored = ignoredReason !== null;

  const tooltipParts: string[] = [];
  if (ignoredReason === "no-incoming") {
    tooltipParts.push("This node has no incoming sorting question and will not be used.");
  } else if (ignoredReason === "all-invalid") {
    tooltipParts.push("All incoming sorting questions are missing or invalid, so this node will not be used.");
  } else if (ignoredReason === "invalid-leaf") {
    tooltipParts.push("Leaf nodes must be visible categories that can receive emails.");
  }
  if (validityWarnings.includes("dead-end")) {
    tooltipParts.push("This node cannot receive emails and has no valid outgoing sorting questions.");
  }
  if (validityWarnings.includes("visible-not-receivable")) {
    tooltipParts.push("Visible categories must be able to receive emails.");
  }
  if (validityWarnings.includes("hidden-destination")) {
    tooltipParts.push("Nodes that receive emails should be visible categories in the MVP.");
  }
  const tooltipText = tooltipParts.join("\n") || undefined;

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
        ) : node.isVisibleCategory ? (
          <span className="badge node-kind node-kind-category">Category</span>
        ) : (
          <span className="badge node-kind node-kind-rule">Sorting Step</span>
        )}
        {node.canReceiveEmails && (
          <span className="badge" style={{ fontSize: 10 }}>
            Receives Emails
          </span>
        )}
        {ignored && <span className="badge badge-unreachable">Ignored</span>}
        {validityWarnings.includes("dead-end") && (
          <span className="badge badge-warning">Dead End</span>
        )}
        {validityWarnings.includes("visible-not-receivable") && (
          <span className="badge badge-warning">Invalid Category</span>
        )}
        {validityWarnings.includes("hidden-destination") && (
          <span className="badge badge-warning">Hidden Destination</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { taxonomy: TaxonomyNodeCard };

// ─── Custom edge component ────────────────────────────────────────────────────

type RFEdgeData = { sortingQuestion: string; targetIgnored: boolean };

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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const sortingQuestion = (data as RFEdgeData | undefined)?.sortingQuestion;
  const targetIgnored = (data as RFEdgeData | undefined)?.targetIgnored ?? false;
  const missing = isMissingSortingQuestion(sortingQuestion);
  const isWarning = missing || targetIgnored;
  const label = formatEdgeLabel(sortingQuestion);
  const strokeColor = isWarning && selected ? tokens.accentDim : selected ? tokens.primary : isWarning ? tokens.accent : tokens.edgeDefault;
  const resolvedMarkerEnd = markerEnd !== undefined
    ? ({ ...(markerEnd as unknown as object), color: strokeColor } as unknown as string)
    : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(resolvedMarkerEnd !== undefined ? { markerEnd: resolvedMarkerEnd } : {})}
        style={{
          stroke: strokeColor,
          strokeWidth: selected ? 2.5 : 1.5,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className={`nodrag nopan edge-label${isWarning && selected ? " edge-label-selected-warning" : isWarning ? " edge-label-warning" : selected ? " edge-label-selected" : ""}`}
        >
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
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
  const [isVisibleCategory, setIsVisibleCategory] = useState(
    node?.isVisibleCategory ?? true
  );
  const [canReceiveEmails, setCanReceiveEmails] = useState(
    node?.canReceiveEmails ?? true
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      description: description || null,
      instructions: node?.instructions ?? null,
      examples: node?.examples ?? [],
      isVisibleCategory,
      canReceiveEmails,
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
            maxLength={100}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </div>
        <div className="form-row" style={{ gap: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={isVisibleCategory}
              onChange={(e) => {
                setIsVisibleCategory(e.target.checked);
                if (e.target.checked) setCanReceiveEmails(true);
              }}
              disabled={isRoot}
            />
            Visible category
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={canReceiveEmails}
              onChange={(e) => {
                setCanReceiveEmails(e.target.checked);
                if (!e.target.checked) setIsVisibleCategory(false);
              }}
              disabled={isRoot}
            />
            Can receive emails
          </label>
        </div>
        {!isRoot && isVisibleCategory && (
          <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>
            Visible categories must be able to receive emails.
          </p>
        )}
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
  const [sortingQuestion, setSortingQuestion] = useState(
    edge?.sortingQuestion ?? ""
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (edge) {
      onSubmit({
        sortingQuestion,
        examples: edge.examples ?? [],
        negativeExamples: edge.negativeExamples ?? [],
        priority: edge.priority ?? 0,
        confidenceThreshold: edge.confidenceThreshold ?? null,
      } satisfies UpdateTaxonomyEdgeInput);
    } else {
      onSubmit({
        sourceNodeId,
        targetNodeId,
        sortingQuestion,
        examples: [],
        negativeExamples: [],
        priority: 0,
        confidenceThreshold: null,
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
        <div className="form-group">
          <label className="form-label">
            Sorting question <span className="required">*</span>
          </label>
          <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 1, marginBottom: 4 }}>
            Short routing questions only. Max 160 characters. Put extra guidance in node descriptions/examples later.
          </p>
          <input
            className="form-input"
            value={sortingQuestion}
            onChange={(e) => setSortingQuestion(e.target.value)}
            required
            maxLength={160}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
            <span style={{ fontSize: 11, color: sortingQuestion.length >= 160 ? "var(--color-destructive)" : "var(--color-subtle)" }}>
              {sortingQuestion.length}/160
            </span>
          </div>
          {sortingQuestion.length >= 160 && (
            <p style={{ fontSize: 11, color: "var(--color-destructive)", marginTop: 2 }}>
              Sorting questions cannot exceed 160 characters.
            </p>
          )}
        </div>
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

  const refetch = useCallback(async () => {
    const [newNodes, newEdges] = await Promise.all([
      api.taxonomyNodes(workspaceId),
      api.taxonomyEdges(workspaceId),
    ]);
    setDbNodes(newNodes);
    setDbEdges(newEdges);
    setRfNodes(toRFNodes(newNodes, newEdges));
    setRfEdges(toRFEdges(newEdges, newNodes));
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
        await api.updateTaxonomyNode(workspaceId, rfNode.id, {
          positionX: Math.round(rfNode.position.x),
          positionY: Math.round(rfNode.position.y),
        });
        setDbNodes((prev) =>
          prev.map((n) =>
            n.id === rfNode.id
              ? { ...n, positionX: rfNode.position.x, positionY: rfNode.position.y }
              : n
          )
        );
      } catch (err) {
        setApiError(err instanceof Error ? err.message : "Failed to save position");
      }
    },
    [workspaceId]
  );

  // ─── Connect nodes: create edge ───────────────────────────────────────────

  const onConnect: OnConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (dbNodes.find((n) => n.id === connection.target && n.isRoot)) return;
      try {
        await api.createTaxonomyEdge(workspaceId, {
          sourceNodeId: connection.source,
          targetNodeId: connection.target,
          sortingQuestion: "",
          examples: [],
          negativeExamples: [],
          priority: 0,
          confidenceThreshold: null,
        });
        await refetch();
      } catch (err) {
        setApiError(err instanceof Error ? err.message : "Failed to create edge");
      }
    },
    [workspaceId, refetch]
  );

  // ─── Click node: open edit panel ──────────────────────────────────────────

  const onNodeClick: NodeMouseHandler<RFNode> = useCallback(
    (_event, rfNode) => {
      const found = dbNodes.find((n) => n.id === rfNode.id);
      if (found) openPanel({ type: "edit-node", node: found });
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
      await api.createTaxonomyNode(workspaceId, data);
      await refetch();
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
      await api.updateTaxonomyNode(workspaceId, nodeId, data);
      await refetch();
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
      await api.createTaxonomyEdge(workspaceId, data as CreateTaxonomyEdgeInput);
      await refetch();
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
      await api.updateTaxonomyEdge(workspaceId, edgeId, data as UpdateTaxonomyEdgeInput);
      await refetch();
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
      await api.deleteTaxonomyNode(workspaceId, nodeId);
      await refetch();
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
      await api.deleteTaxonomyEdge(workspaceId, edgeId);
      await refetch();
      setPanel({ type: "none" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to delete edge");
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
