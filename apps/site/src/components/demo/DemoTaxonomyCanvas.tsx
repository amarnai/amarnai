"use client";

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  type NodeProps,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TaxonomyNodeCardBase } from "@amarnai/ui/taxonomy";
import type { DemoNode, DemoNodeData } from "./demo-seed";
import { DEMO_NODES, DEMO_EDGES } from "./demo-seed";

const EDGE_COLOR = "#94a3b8";

function DemoNodeCard({ data }: NodeProps<DemoNode>) {
  const { label, description, isRoot } = data as DemoNodeData;
  return (
    <TaxonomyNodeCardBase
      name={label}
      {...(description ? { description } : {})}
      isRoot={isRoot}
    />
  );
}

const nodeTypes = { "demo-node": DemoNodeCard };

function DemoCanvasInner() {
  const [nodes, , onNodesChange] = useNodesState<DemoNode>(DEMO_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEMO_EDGES);

  function onConnect(connection: Connection) {
    setEdges((eds) =>
      addEdge(
        {
          ...connection,
          markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR },
          style: { stroke: EDGE_COLOR, strokeWidth: 1.5 },
        },
        eds,
      ),
    );
  }

  return (
    <div className="taxonomy-canvas-wrap" style={{ minHeight: 520 }}>
      <div className="taxonomy-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          deleteKeyCode={null}
          nodesDraggable
          nodesConnectable
          fitView
          fitViewOptions={{ padding: 0.25 }}
          onInit={(instance) => {
            requestAnimationFrame(() => instance.fitView({ padding: 0.25 }));
          }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

export function DemoTaxonomyCanvas() {
  return (
    <ReactFlowProvider>
      <DemoCanvasInner />
    </ReactFlowProvider>
  );
}
