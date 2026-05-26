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
 */
export type ClassifyThreadJobData = {
  workspaceId: string;
  /** Internal EmailThread.id — not the Gmail thread ID. */
  emailThreadId: string;
};

/** Payload for a `backfill-inbox` job. One job per workspace, run once. */
export type BackfillInboxJobData = {
  workspaceId: string;
};
