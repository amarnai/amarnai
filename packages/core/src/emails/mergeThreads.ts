import type { ThreadItem } from "./types.js";

// Merge a fresh server thread list into local state without clobbering
// in-progress draft state. Two races can occur if we blindly replace:
//   1. The server may not yet have committed a GENERATING placeholder when
//      a refresh fires, so it returns isDrafting:false even though the client
//      already set it to true — discarding the loading indicator.
//   2. The selected thread may fall outside the first-page window (>50 threads),
//      causing selectedThread to become null, which unmounts the preview and
//      loses the draftState.
// The merge preserves local isDrafting/hasDraft until the server confirms the
// final state, and re-inserts the selected thread if the server dropped it.
export function mergeThreads(
  fresh: ThreadItem[],
  prev: ThreadItem[],
  pinnedId: string | null,
): ThreadItem[] {
  const prevMap = new Map(prev.map((t) => [t.id, t]));
  const merged = fresh.map((t) => {
    const existing = prevMap.get(t.id);
    if (!existing) return t;
    // Keep isDrafting true until the server confirms the draft is proposed
    // (hasDraft:true means PROPOSED is in the DB, so drafting is over).
    const isDrafting = (t.isDrafting || existing.isDrafting) && !t.hasDraft;
    const hasDraft = t.hasDraft || existing.hasDraft;
    return { ...t, isDrafting, hasDraft };
  });
  // Re-insert the selected thread if the server omitted it (pagination drop).
  if (pinnedId && !merged.some((t) => t.id === pinnedId)) {
    const pinned = prevMap.get(pinnedId);
    if (pinned) merged.push(pinned);
  }
  return merged;
}
