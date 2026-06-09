import { describe, expect, it } from "vitest";
import {
  historyReducer,
  snapshotsEqual,
  type GraphSnapshot,
  type HistoryState,
} from "./useTaxonomyHistory";
import type { TaxonomyNode, TaxonomyEdge } from "@/lib/api";

function makeNode(id: string, overrides: Partial<TaxonomyNode> = {}): TaxonomyNode {
  return {
    id,
    workspaceId: "ws_1",
    name: id,
    description: null,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot: false,
    positionX: 0,
    positionY: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    threadCount: 0,
    ...overrides,
  };
}

function makeEdge(id: string, sourceNodeId = "a", targetNodeId = "b"): TaxonomyEdge {
  return {
    id,
    workspaceId: "ws_1",
    sourceNodeId,
    targetNodeId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function init(present: GraphSnapshot = snap0): HistoryState {
  return { past: [], present, future: [] };
}

const snap0: GraphSnapshot = { nodes: [makeNode("root", { isRoot: true })], edges: [] };
const snap1: GraphSnapshot = {
  nodes: [makeNode("root", { isRoot: true }), makeNode("b")],
  edges: [],
};
const snap2: GraphSnapshot = {
  nodes: [makeNode("root", { isRoot: true }), makeNode("b")],
  edges: [makeEdge("e1", "root", "b")],
};

// ─── historyReducer ───────────────────────────────────────────────────────────

describe("historyReducer", () => {
  it("initial state: canUndo and canRedo are false (empty past and future)", () => {
    const state = init();
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
  });

  it("PUSH records edit and enables undo", () => {
    const state = historyReducer(init(), { type: "PUSH", snapshot: snap1 });
    expect(state.past).toHaveLength(1);
    expect(state.past[0]).toBe(snap0);
    expect(state.present).toBe(snap1);
    expect(state.future).toHaveLength(0);
  });

  it("UNDO restores previous graph and moves present to future (enabling redo)", () => {
    const afterPush = historyReducer(init(), { type: "PUSH", snapshot: snap1 });
    const afterUndo = historyReducer(afterPush, { type: "UNDO" });
    expect(afterUndo.present).toBe(snap0);
    expect(afterUndo.past).toHaveLength(0);
    expect(afterUndo.future).toHaveLength(1);
    expect(afterUndo.future[0]).toBe(snap1);
  });

  it("REDO restores next graph", () => {
    const afterPush = historyReducer(init(), { type: "PUSH", snapshot: snap1 });
    const afterUndo = historyReducer(afterPush, { type: "UNDO" });
    const afterRedo = historyReducer(afterUndo, { type: "REDO" });
    expect(afterRedo.present).toBe(snap1);
    expect(afterRedo.past).toHaveLength(1);
    expect(afterRedo.future).toHaveLength(0);
  });

  it("new edit after undo clears future", () => {
    const afterPush = historyReducer(init(), { type: "PUSH", snapshot: snap1 });
    const afterUndo = historyReducer(afterPush, { type: "UNDO" });
    // future has snap1 at this point; new edit clears it
    const afterNewEdit = historyReducer(afterUndo, { type: "PUSH", snapshot: snap2 });
    expect(afterNewEdit.future).toHaveLength(0);
    expect(afterNewEdit.present).toBe(snap2);
    expect(afterNewEdit.past).toHaveLength(1);
    expect(afterNewEdit.past[0]).toBe(snap0);
  });

  it("no-op PUSH (identical snapshot) is ignored", () => {
    const identical: GraphSnapshot = {
      nodes: [makeNode("root", { isRoot: true })],
      edges: [],
    };
    const state = historyReducer(init(snap0), { type: "PUSH", snapshot: identical });
    // same structure as snap0 — should not record a history entry
    expect(state.past).toHaveLength(0);
    expect(state.present).toBe(snap0);
  });

  it("drag records only the final committed position (one push = one history entry)", () => {
    // Simulates onNodeDragStop: push called once with the final position
    const finalPos: GraphSnapshot = {
      nodes: [makeNode("root", { isRoot: true, positionX: 200, positionY: 150 })],
      edges: [],
    };
    const state = historyReducer(init(), { type: "PUSH", snapshot: finalPos });
    // Exactly one past entry, present holds the committed final position
    expect(state.past).toHaveLength(1);
    expect(state.present.nodes[0]?.positionX).toBe(200);
    expect(state.present.nodes[0]?.positionY).toBe(150);
  });

  it("UNDO on empty past is a no-op", () => {
    const state = historyReducer(init(), { type: "UNDO" });
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(state.present).toBe(snap0);
  });

  it("REDO on empty future is a no-op", () => {
    const state = historyReducer(init(), { type: "REDO" });
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(state.present).toBe(snap0);
  });

  it("RESET clears all history", () => {
    const afterPush = historyReducer(init(), { type: "PUSH", snapshot: snap1 });
    const afterReset = historyReducer(afterPush, { type: "RESET", snapshot: snap2 });
    expect(afterReset.past).toHaveLength(0);
    expect(afterReset.future).toHaveLength(0);
    expect(afterReset.present).toBe(snap2);
  });

  it("SYNC updates present without touching past or future", () => {
    const afterPush = historyReducer(init(), { type: "PUSH", snapshot: snap1 });
    const afterUndo = historyReducer(afterPush, { type: "UNDO" });
    // after undo: past=[], present=snap0, future=[snap1]
    const synced: GraphSnapshot = { nodes: [makeNode("root", { isRoot: true })], edges: [] };
    const afterSync = historyReducer(afterUndo, { type: "SYNC", snapshot: synced });
    expect(afterSync.past).toHaveLength(0);
    expect(afterSync.future).toHaveLength(1);
    expect(afterSync.present).toBe(synced);
  });
});

// ─── snapshotsEqual ───────────────────────────────────────────────────────────

describe("snapshotsEqual", () => {
  it("returns true for structurally identical snapshots", () => {
    const a: GraphSnapshot = { nodes: [makeNode("a")], edges: [makeEdge("e1")] };
    const b: GraphSnapshot = { nodes: [makeNode("a")], edges: [makeEdge("e1")] };
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it("returns false when a node position changes", () => {
    const a: GraphSnapshot = { nodes: [makeNode("a")], edges: [] };
    const b: GraphSnapshot = { nodes: [makeNode("a", { positionX: 50 })], edges: [] };
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("returns false when a node name changes", () => {
    const a: GraphSnapshot = { nodes: [makeNode("a")], edges: [] };
    const b: GraphSnapshot = { nodes: [makeNode("a", { name: "renamed" })], edges: [] };
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("returns false when a node description changes", () => {
    const a: GraphSnapshot = { nodes: [makeNode("a", { description: "old" })], edges: [] };
    const b: GraphSnapshot = { nodes: [makeNode("a", { description: "new" })], edges: [] };
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("returns false when an edge is added", () => {
    const a: GraphSnapshot = { nodes: [makeNode("a")], edges: [] };
    const b: GraphSnapshot = { nodes: [makeNode("a")], edges: [makeEdge("e1")] };
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("returns false when a node is added", () => {
    const a: GraphSnapshot = { nodes: [makeNode("a")], edges: [] };
    const b: GraphSnapshot = { nodes: [makeNode("a"), makeNode("c")], edges: [] };
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("returns true when only timestamps differ (timestamps are not tracked)", () => {
    const a: GraphSnapshot = {
      nodes: [makeNode("a", { createdAt: "2026-01-01T00:00:00.000Z" })],
      edges: [],
    };
    const b: GraphSnapshot = {
      nodes: [makeNode("a", { createdAt: "2026-06-01T12:00:00.000Z" })],
      edges: [],
    };
    expect(snapshotsEqual(a, b)).toBe(true);
  });
});
