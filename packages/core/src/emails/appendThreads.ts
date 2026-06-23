import type { ThreadItem } from "./types.js";

// Append a freshly-fetched next page onto the already-loaded list, de-duplicating
// by id and preserving order. Used by the "load more" / infinite-scroll path so
// pagination grows the list instead of replacing it. A thread that somehow
// appears in both (e.g. it shifted across the page boundary between fetches) is
// kept once, in its existing position.
export function appendThreads(prev: ThreadItem[], next: ThreadItem[]): ThreadItem[] {
  const seen = new Set(prev.map((t) => t.id));
  return [...prev, ...next.filter((t) => !seen.has(t.id))];
}
