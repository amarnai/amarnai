import { useCallback, useReducer } from "react";
import type { TaxonomyNode, TaxonomyEdge } from "@/lib/api";

export type GraphSnapshot = {
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
};

export type HistoryState = {
  past: GraphSnapshot[];
  present: GraphSnapshot;
  future: GraphSnapshot[];
};

type HistoryAction =
  | { type: "PUSH"; snapshot: GraphSnapshot }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SYNC"; snapshot: GraphSnapshot }
  | { type: "RESET"; snapshot: GraphSnapshot };

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

export function useTaxonomyHistory(initial: GraphSnapshot) {
  const [state, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initial,
    future: [],
  });

  const push = useCallback((snapshot: GraphSnapshot) => {
    dispatch({ type: "PUSH", snapshot });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: "UNDO" });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: "REDO" });
  }, []);

  const sync = useCallback((snapshot: GraphSnapshot) => {
    dispatch({ type: "SYNC", snapshot });
  }, []);

  const reset = useCallback((snapshot: GraphSnapshot) => {
    dispatch({ type: "RESET", snapshot });
  }, []);

  return {
    present: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    undoTarget: state.past.at(-1) ?? null,
    redoTarget: state.future[0] ?? null,
    push,
    undo,
    redo,
    sync,
    reset,
  };
}
