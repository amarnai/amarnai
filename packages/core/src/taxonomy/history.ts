import type { TaxonomyNode, TaxonomyEdge } from "@amarnai/api-client";

export type GraphSnapshot = {
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
};

export type HistoryState = {
  past: GraphSnapshot[];
  present: GraphSnapshot;
  future: GraphSnapshot[];
};

export type HistoryAction =
  | { type: "PUSH"; snapshot: GraphSnapshot }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SYNC"; snapshot: GraphSnapshot }
  | { type: "RESET"; snapshot: GraphSnapshot };

/**
 * Compares every editable field. A field left out here is invisible to undo in
 * the worst way: the reducer drops the PUSH entirely, so changing it does not
 * even become an undoable step, and a later undo silently reverts around it.
 * Keep this in step with the fields the editor can write.
 */
export function snapshotsEqual(a: GraphSnapshot, b: GraphSnapshot): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  const aNodes = new Map(a.nodes.map((n) => [n.id, n]));
  for (const bn of b.nodes) {
    const an = aNodes.get(bn.id);
    if (!an) return false;
    if (
      an.name !== bn.name ||
      an.description !== bn.description ||
      an.instructions !== bn.instructions ||
      an.draftPrompt !== bn.draftPrompt ||
      an.colorKey !== bn.colorKey ||
      an.positionX !== bn.positionX ||
      an.positionY !== bn.positionY ||
      JSON.stringify(an.examples) !== JSON.stringify(bn.examples)
    ) {
      return false;
    }
  }
  const aEdgeIds = new Set(a.edges.map((e) => e.id));
  for (const be of b.edges) {
    if (!aEdgeIds.has(be.id)) return false;
  }
  return true;
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "PUSH": {
      if (snapshotsEqual(state.present, action.snapshot)) return state;
      return {
        past: [...state.past, state.present],
        present: action.snapshot,
        future: [],
      };
    }
    case "UNDO": {
      if (state.past.length === 0) return state;
      const to = state.past[state.past.length - 1]!;
      return {
        past: state.past.slice(0, -1),
        present: to,
        future: [state.present, ...state.future],
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const to = state.future[0]!;
      return {
        past: [...state.past, state.present],
        present: to,
        future: state.future.slice(1),
      };
    }
    case "SYNC": {
      return { ...state, present: action.snapshot };
    }
    case "RESET": {
      return { past: [], present: action.snapshot, future: [] };
    }
  }
}
