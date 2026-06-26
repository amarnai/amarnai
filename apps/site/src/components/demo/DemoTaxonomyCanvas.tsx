"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BaseEdge,
  getBezierPath,
  useNodesState,
  useEdgesState,
  useInternalNode,
  addEdge,
  Position,
  type NodeProps,
  type EdgeProps,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TaxonomyNodeCardBase, taxonomyTokens } from "@amarnai/ui/taxonomy";
import { SparkleIcon } from "@/components/landing/icons";
import type { DemoNode, DemoNodeData } from "./demo-seed";
import { DEMO_NODES, DEMO_EDGES, DEMO_NODE_DEPTH, DEMO_NODE_SIZE, DEMO_ARROW } from "./demo-seed";

// Same bezier edge as the web taxonomy canvas, but the endpoints are derived
// from the live node position plus the node's fixed size rather than React
// Flow's DOM-measured handle bounds. Those bounds are measured at unpredictable
// moments (first paint vs. mid-animation), which made edges attach at different
// spots in the initial and post-animation states. Computing them ourselves makes
// both states identical while still following nodes as they are dragged. The
// endpoints land exactly on the node edges so the arrowhead meets the node like
// the web canvas, with no gap.
function DemoTaxonomyEdge({ id, source, target, markerEnd }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const sourceSize = DEMO_NODE_SIZE[source];
  const targetSize = DEMO_NODE_SIZE[target];
  if (!sourceSize || !targetSize) return null;

  const sourcePos = sourceNode.internals.positionAbsolute;
  const targetPos = targetNode.internals.positionAbsolute;

  const [edgePath] = getBezierPath({
    sourceX: sourcePos.x + sourceSize.width,
    sourceY: sourcePos.y + sourceSize.height / 2,
    sourcePosition: Position.Right,
    targetX: targetPos.x,
    targetY: targetPos.y + targetSize.height / 2,
    targetPosition: Position.Left,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      {...(markerEnd !== undefined ? { markerEnd } : {})}
      style={{ stroke: taxonomyTokens.edgeDefault, strokeWidth: 1.5 }}
    />
  );
}

const edgeTypes = { "taxonomy-edge": DemoTaxonomyEdge };

// Reveal animation pacing (ms). Kept short so the unfold feels snappy.
const HOLD_INBOX = 480; // collapsed-to-inbox beat before children appear
const HOLD_CHILDREN = 620; // children beat before grandchildren appear
const STAGGER = 70; // per-node delay within a level
const SETTLE = 420; // grace after the last level before re-enabling drag

// Order of each node within its depth level, for staggered entrances.
const ORDER_IN_DEPTH: Record<string, number> = (() => {
  const order: Record<string, number> = {};
  const seen: Record<number, number> = {};
  for (const node of DEMO_NODES) {
    const depth = DEMO_NODE_DEPTH[node.id] ?? 0;
    order[node.id] = seen[depth] ?? 0;
    seen[depth] = (seen[depth] ?? 0) + 1;
  }
  return order;
})();

function DemoNodeCard({ data }: NodeProps<DemoNode>) {
  const { label, description, isRoot, entering, enterDelay } = data as DemoNodeData;
  return (
    <div
      className={entering ? "demo-node-enter" : undefined}
      style={entering ? { animationDelay: `${enterDelay ?? 0}ms` } : undefined}
    >
      <TaxonomyNodeCardBase
        name={label}
        {...(description ? { description } : {})}
        isRoot={isRoot}
      />
    </div>
  );
}

const nodeTypes = { "demo-node": DemoNodeCard };

function DemoCanvasInner() {
  const [nodes, , onNodesChange] = useNodesState<DemoNode>(DEMO_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEMO_EDGES);

  // -1 means "show everything" (the default, fully interactive state).
  // During a generate run this steps 0 -> 1 -> 2 to unfold the tree.
  const [revealDepth, setRevealDepth] = useState(-1);
  const [generating, setGenerating] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // The tree unfolds in place: the viewport never moves, levels just appear.
  // 1. collapse to Inbox, 2. reveal its children, 3. reveal the grandchildren.
  const runGenerate = useCallback(() => {
    clearTimers();
    setGenerating(true);
    setRevealDepth(0);

    timers.current.push(
      setTimeout(() => setRevealDepth(1), HOLD_INBOX),
    );

    timers.current.push(
      setTimeout(() => {
        setRevealDepth(2);
        timers.current.push(
          setTimeout(() => {
            setGenerating(false);
            setRevealDepth(-1);
          }, SETTLE),
        );
      }, HOLD_INBOX + HOLD_CHILDREN),
    );
  }, [clearTimers]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "taxonomy-edge",
            markerEnd: { ...DEMO_ARROW },
            data: { targetIgnored: false },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  // The reveal hides deeper levels with React Flow's `hidden` flag instead of
  // removing them from the arrays. Keeping every edge in the store preserves
  // the shared arrowhead <marker> def across the animation (removing all edges
  // tears the def down and the markers never come back). The freshly revealed
  // level is flagged so its cards/edges animate in (staggered).
  const visibleNodes = useMemo<DemoNode[]>(() => {
    return nodes.map((n) => {
      const depth = DEMO_NODE_DEPTH[n.id] ?? 0;
      const hidden = revealDepth >= 0 && depth > revealDepth;
      const entering = revealDepth >= 0 && generating && depth === revealDepth && revealDepth > 0;
      return {
        ...n,
        hidden,
        data: { ...n.data, entering, enterDelay: (ORDER_IN_DEPTH[n.id] ?? 0) * STAGGER },
      };
    });
  }, [nodes, revealDepth, generating]);

  const visibleEdges = useMemo(() => {
    return edges.map((e) => {
      const sd = DEMO_NODE_DEPTH[e.source] ?? 0;
      const td = DEMO_NODE_DEPTH[e.target] ?? 0;
      const hidden = revealDepth >= 0 && Math.max(sd, td) > revealDepth;
      const entering = revealDepth >= 0 && generating && td === revealDepth && revealDepth > 0;
      // Base edges never carry a className, so omitting it (rather than setting
      // undefined) is enough to clear the enter animation once a level settles.
      return { ...e, hidden, ...(entering ? { className: "demo-edge-enter" } : {}) };
    });
  }, [edges, revealDepth, generating]);

  return (
    <>
      <div className="ld-frame-bar">
        <div className="ld-crumbs">
          <span>Acme Workspace</span>
          <span className="ld-sep">/</span>
          <span className="ld-here">Plan</span>
        </div>
        <div className="ld-play-note">
          Drag and connect. It&apos;s fully interactive.
        </div>
        <button
          type="button"
          className="ld-btn accent demo-generate-btn"
          onClick={runGenerate}
          disabled={generating}
          aria-label="Generate plan from inbox"
        >
          <SparkleIcon />
          {generating ? "Generating…" : "Generate from inbox"}
        </button>
      </div>
      <div className="ld-demo-stage">
        <div className="taxonomy-canvas-wrap" style={{ minHeight: 520 }}>
          <div className="taxonomy-canvas">
            <ReactFlow
              nodes={visibleNodes}
              edges={visibleEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={!generating}
              nodesConnectable={!generating}
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
      </div>
    </>
  );
}

export function DemoTaxonomyCanvas() {
  return (
    <ReactFlowProvider>
      <DemoCanvasInner />
    </ReactFlowProvider>
  );
}
