import { useCallback, useReducer } from "react";
import { historyReducer, type GraphSnapshot } from "@amarnai/core/taxonomy";

// The pure undo/redo reducer + snapshot diffing live in @amarnai/core/taxonomy.
// This thin React wrapper binds the reducer to useReducer/useCallback and is
// shared by every surface that hosts the editor.
export type { GraphSnapshot, HistoryState } from "@amarnai/core/taxonomy";
export { snapshotsEqual, historyReducer } from "@amarnai/core/taxonomy";

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
