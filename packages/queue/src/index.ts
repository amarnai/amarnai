// ─── Redis ────────────────────────────────────────────────────────────────────

export function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

// ─── Deduplication key prefixes ───────────────────────────────────────────────
// Used by sorting-queue API endpoints and the cancel endpoint to build and
// recognise classify-thread job dedup keys without scattering magic strings.

export const DEDUP_CLASSIFY_UNROUTED     = "classify_unrouted";
export const DEDUP_CLASSIFY_UNCLASSIFIED = "classify_unclassified";

// ─── Queue names ──────────────────────────────────────────────────────────────
// Single source of truth. Import these constants everywhere instead of
// hardcoding strings so a rename stays a one-line change.

export const QUEUE_SYNC_INBOX = "sync-inbox";
export const QUEUE_CLASSIFY_THREAD = "classify-thread";
export const QUEUE_BACKFILL_INBOX = "backfill-inbox";

// ─── Job data types ───────────────────────────────────────────────────────────

/** Payload for a `sync-inbox` job. One job per workspace per polling cycle. */
export type SyncInboxJobData = {
  workspaceId: string;
};

/**
 * Payload for a `classify-thread` job.
 * One job per thread that changed during an inbox sync (or triggered manually).
 *
 * `triageOnly` — skip routing (taxonomy node selection) and only re-run
 * the triage metadata analysis (priority, urgency, risk, etc.) on the most
 * recent existing classification record. Used by the "Re-analyze" UI action.
 */
export type ClassifyThreadJobData = {
  workspaceId: string;
  /** Internal EmailThread.id — not the Gmail thread ID. */
  emailThreadId: string;
  triageOnly?: boolean;
};

/** Payload for a `backfill-inbox` job. One job per workspace, run once. */
export type BackfillInboxJobData = {
  workspaceId: string;
};
