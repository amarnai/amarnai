import { createHash } from "node:crypto";

/**
 * Compact, stable signature of a thread's current message-id set.
 *
 * Two consumers share it and must never drift:
 *   1. The LIVE classify dedup key (sync-inbox), where it makes the key
 *      CONTENT-aware: a spurious re-discovery of an unchanged thread (overlapping
 *      historyId, a sync retry) yields the same signature and collapses to one job,
 *      while a genuinely-new (or removed) message yields a different signature and
 *      is NOT collapsed — so it re-sorts instead of being silently dropped while a
 *      prior classify for the old content is still in flight.
 *   2. ThreadSummary cache invalidation: a stored summary whose signature no longer
 *      matches the thread's messages is stale and regenerates on next open.
 *
 * Order-independent (ids are sorted) and truncated because the value only needs to
 * be collision-resistant, not reversible.
 *
 * Lives in @amarnai/db rather than @amarnai/shared because it needs node:crypto and
 * shared is bundled into browser surfaces; both consumers are server-side and
 * already depend on this package.
 */
export function messageSetSignature(providerMessageIds: string[]): string {
  return createHash("sha1").update([...providerMessageIds].sort().join(",")).digest("hex").slice(0, 16);
}
