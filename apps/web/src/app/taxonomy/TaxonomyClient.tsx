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
import {
  api,
  type TaxonomyNode,
  type TaxonomyEdge,
  type CreateTaxonomyNodeInput,
  type UpdateTaxonomyNodeInput,
  type CreateTaxonomyEdgeInput,
  type UpdateTaxonomyEdgeInput,
} from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseLines(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function nodeById(nodes: TaxonomyNode[], id: string): TaxonomyNode | undefined {
  return nodes.find((n) => n.id === id);
}

const DEFAULT_SORTING_QUESTION = "Describe when emails should follow this path.";

function isMissingSortingQuestion(q: string | null | undefined): boolean {
  if (!q) return true;
  const trimmed = q.trim();
  return trimmed === "" || trimmed === DEFAULT_SORTING_QUESTION;
}

function formatEdgeLabel(q: string | null | undefined): string {
  if (isMissingSortingQuestion(q)) return "Missing sorting question";
  return q!.trim();
}

type IgnoredReason = "no-incoming" | "all-invalid" | null;

function computeIgnoredReasons(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[]
): Map<string, IgnoredReason> {
  const result = new Map<string, IgnoredReason>();
  for (const node of nodes) {
    if (node.isRoot) continue;
    const incoming = edges.filter((e) => e.targetNodeId === node.id);
    if (incoming.length === 0) {
      result.set(node.id, "no-incoming");
    } else if (incoming.every((e) => isMissingSortingQuestion(e.sortingQuestion))) {
      result.set(node.id, "all-invalid");
    }
  }
  return result;
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

function toRFEdge(e: TaxonomyEdge): Edge {
  const missing = isMissingSortingQuestion(e.sortingQuestion);
  return {
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: "taxonomy-edge",
    markerEnd: { type: MarkerType.ArrowClosed, color: missing ? "#f59e0b" : "#94a3b8" },
    data: { sortingQuestion: e.sortingQuestion },
  };
}

// ─── Custom node component ────────────────────────────────────────────────────

function TaxonomyNodeCard({ data, selected }: NodeProps<RFNode>) {
  const { node, ignoredReason } = data;
  const ignored = ignoredReason !== null;
  const tooltipText =
    ignoredReason === "no-incoming"
      ? "This node has no incoming sorting question and will not be used."
      : ignoredReason === "all-invalid"
      ? "All incoming sorting questions are missing or invalid, so this node will not be used."
      : undefined;
  return (
    <div
      className={`taxonomy-node-card${selected ? " selected" : ""}${ignored ? " unreachable" : ""}`}
      title={tooltipText}
    >
      {!node.isRoot && <Handle type="target" position={Position.Left} />}
      <div className="node-name">{node.name}</div>
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
        {ignored && (
          <span className="badge badge-unreachable">Ignored</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { taxonomy: TaxonomyNodeCard };

// ─── Custom edge component ────────────────────────────────────────────────────

type RFEdgeData = { sortingQuestion: string };

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
  const missing = isMissingSortingQuestion(sortingQuestion);
  const label = formatEdgeLabel(sortingQuestion);
  const strokeColor = missing && selected ? "#d97706" : selected ? "#6366f1" : missing ? "#f59e0b" : "#94a3b8";
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
          className={`nodrag nopan edge-label${missing && selected ? " edge-label-selected-warning" : missing ? " edge-label-warning" : selected ? " edge-label-selected" : ""}`}
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
  const [instructions, setInstructions] = useState(node?.instructions ?? "");
  const [examples, setExamples] = useState((node?.examples ?? []).join("\n"));
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
      instructions: instructions || null,
      examples: parseLines(examples),
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
        <div className="form-group">
          <label className="form-label">Instructions</label>
          <textarea
            className="form-textarea"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Examples (one per line)</label>
          <textarea
            className="form-textarea"
            value={examples}
            onChange={(e) => setExamples(e.target.value)}
          />
        </div>
        <div className="form-row" style={{ gap: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={isVisibleCategory}
              onChange={(e) => setIsVisibleCategory(e.target.checked)}
              disabled={isRoot}
            />
            Visible category
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={canReceiveEmails}
              onChange={(e) => setCanReceiveEmails(e.target.checked)}
              disabled={isRoot}
            />
            Can receive emails
          </label>
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
  const [sortingQuestion, setSortingQuestion] = useState(
    edge?.sortingQuestion ?? ""
  );
  const [examples, setExamples] = useState((edge?.examples ?? []).join("\n"));
  const [negativeExamples, setNegativeExamples] = useState(
    (edge?.negativeExamples ?? []).join("\n")
  );
  const [priority, setPriority] = useState(edge?.priority ?? 0);
  const [confidenceThreshold, setConfidenceThreshold] = useState(
    edge?.confidenceThreshold != null ? String(edge.confidenceThreshold) : ""
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const threshold =
      confidenceThreshold !== "" ? Number(confidenceThreshold) : null;
    if (edge) {
      onSubmit({
        sortingQuestion,
        examples: parseLines(examples),
        negativeExamples: parseLines(negativeExamples),
        priority,
        confidenceThreshold: threshold,
      } satisfies UpdateTaxonomyEdgeInput);
    } else {
      onSubmit({
        sourceNodeId,
        targetNodeId,
        sortingQuestion,
        examples: parseLines(examples),
        negativeExamples: parseLines(negativeExamples),
        priority,
        confidenceThreshold: threshold,
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
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 1, marginBottom: 4 }}>
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
            <span style={{ fontSize: 11, color: sortingQuestion.length >= 160 ? "#dc2626" : "#9ca3af" }}>
              {sortingQuestion.length}/160
            </span>
          </div>
          {sortingQuestion.length >= 160 && (
            <p style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>
              Sorting questions cannot exceed 160 characters.
            </p>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Examples (one per line)</label>
          <textarea
            className="form-textarea"
            value={examples}
            onChange={(e) => setExamples(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Negative examples (one per line)</label>
          <textarea
            className="form-textarea"
            value={negativeExamples}
            onChange={(e) => setNegativeExamples(e.target.value)}
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Priority</label>
            <input
              className="form-input"
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confidence (0–1)</label>
            <input
              className="form-input"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(e.target.value)}
              placeholder="None"
            />
          </div>
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
    initialEdges.map(toRFEdge)
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
    setRfEdges(newEdges.map(toRFEdge));
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
