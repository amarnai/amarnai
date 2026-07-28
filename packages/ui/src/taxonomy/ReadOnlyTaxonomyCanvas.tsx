"use client";

import { ReactFlow, ReactFlowProvider, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { TaxonomyNode, TaxonomyEdge } from "@amarnai/shared";
import {
  taxonomyNodeTypes as nodeTypes,
  taxonomyEdgeTypes as edgeTypes,
  toRFNodes,
  toRFEdges,
  TAXONOMY_MIN_ZOOM,
} from "./rfGraph.js";
import { useTheme } from "../theme/useTheme.js";
import "./taxonomy-canvas.css";

function ReadOnlyTaxonomyCanvasInner({
  nodes,
  edges,
}: {
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
}) {
  // Re-render on theme change so edge markers/strokes re-read the themed
  // --rf-edge-* vars (readEdgeColors reads them at render time).
  useTheme();
  const rfNodes = toRFNodes(nodes, edges);
  const rfEdges = toRFEdges(edges, nodes);

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
          minZoom={TAXONOMY_MIN_ZOOM}
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
