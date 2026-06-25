"use client";

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { TaxonomyNode, TaxonomyEdge } from "@amarnai/shared";
import { computeIgnoredReasons, type IgnoredReason } from "@amarnai/core/taxonomy";
import {
  TaxonomyNodeCard,
  type TaxonomyRFNode,
} from "./TaxonomyNodeCard.js";
import { TaxonomyEdgeRenderer } from "./TaxonomyEdge.js";
import { taxonomyTokens } from "./tokens.js";
import "./taxonomy-canvas.css";

const nodeTypes = { taxonomy: TaxonomyNodeCard };
const edgeTypes = { "taxonomy-edge": TaxonomyEdgeRenderer };

function toRFNode(n: TaxonomyNode, ignoredReason: IgnoredReason): TaxonomyRFNode {
  return {
    id: n.id,
    type: "taxonomy",
    position: { x: n.positionX, y: n.positionY },
    data: { node: n, ignoredReason },
  };
}

function toRFEdge(e: TaxonomyEdge, ignoredMap: Map<string, IgnoredReason>): Edge {
  const targetIgnored = ignoredMap.has(e.targetNodeId);
  return {
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: "taxonomy-edge",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: targetIgnored ? taxonomyTokens.accent : taxonomyTokens.edgeDefault,
    },
    data: { targetIgnored },
  };
}

function ReadOnlyTaxonomyCanvasInner({
  nodes,
  edges,
}: {
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
}) {
  const ignoredMap = computeIgnoredReasons(nodes, edges);
  const rfNodes = nodes.map((n) => toRFNode(n, ignoredMap.get(n.id) ?? null));
  const rfEdges = edges.map((e) => toRFEdge(e, ignoredMap));

  return (
    <div className="taxonomy-canvas-wrap">
      <div className="taxonomy-canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

export interface ReadOnlyTaxonomyCanvasProps {
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
}

export function ReadOnlyTaxonomyCanvas({
  nodes,
  edges,
}: ReadOnlyTaxonomyCanvasProps) {
  return (
    <ReactFlowProvider>
      <ReadOnlyTaxonomyCanvasInner nodes={nodes} edges={edges} />
    </ReactFlowProvider>
  );
}
