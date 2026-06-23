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
// final state, and re-inserts the selected thread if it was somehow dropped.
//
// `keepTail` controls what happens to prev threads absent from the fresh page.
// When false (the default, used before any pagination), the list is a straight
// replace: a thread the server stopped returning — e.g. it was trashed and is
// now filtered out — correctly disappears. When true (the caller has loaded
// pages beyond the first), already-loaded later pages are preserved so a refresh
// that only re-fetches page 1 does not collapse the list back to 50. The
// accepted trade-off in that mode: a thread removed from within the first-page
// window lingers until a full reload, which only affects users who have
// paginated.
export function mergeThreads(
  fresh: ThreadItem[],
  prev: ThreadItem[],
  pinnedId: string | null,
  keepTail = false,
): ThreadItem[] {
  const prevMap = new Map(prev.map((t) => [t.id, t]));
  const freshIds = new Set(fresh.map((t) => t.id));
  // Fresh page-1 region, in server order, with local draft state preserved.
  const merged = fresh.map((t) => {
    const existing = prevMap.get(t.id);
    if (!existing) return t;
    // Keep isDrafting true until the server confirms the draft is proposed
    // (hasDraft:true means PROPOSED is in the DB, so drafting is over).
    const isDrafting = (t.isDrafting || existing.isDrafting) && !t.hasDraft;
    const hasDraft = t.hasDraft || existing.hasDraft;
    return { ...t, isDrafting, hasDraft };
  });
  // Preserve already-loaded later pages only when pagination is active.
  const tail = keepTail ? prev.filter((t) => !freshIds.has(t.id)) : [];
  const result = [...merged, ...tail];
  // Defensive: the pinned (selected) thread must never disappear.
  if (pinnedId && !result.some((t) => t.id === pinnedId)) {
    const pinned = prevMap.get(pinnedId);
    if (pinned) result.push(pinned);
  }
  return result;
}
