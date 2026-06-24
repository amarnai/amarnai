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
export const QUEUE_LIFECYCLE_EMAIL = "lifecycle-email";
export const QUEUE_GENERATE_TAXONOMY = "generate-taxonomy";

// ─── Job data types ───────────────────────────────────────────────────────────

/** Payload for a `sync-inbox` job. One job per workspace per polling cycle. */
export type SyncInboxJobData = {
  workspaceId: string;
};

/**
 * Origin of a classify-thread job. Mirrors the Prisma `ClassificationSource`
 * enum (kept as a string union here so the queue package stays free of a Prisma
 * dependency). The worker stamps this onto the EmailClassification row, and the
 * monthly thread-sort quota meters every source except BACKFILL.
 *   LIVE     — automatic sort from an inbox sync (new/changed thread or stuck recovery).
 *   BACKFILL — the one-time historical backfill (exempt from the monthly quota).
 *   REROUTE  — resume / route-unrouted / reroute-unclassified re-sorts.
 *   MANUAL   — a user-triggered sort via the API.
 */
export type ClassifyThreadSource = "LIVE" | "BACKFILL" | "REROUTE" | "MANUAL";

/**
 * Payload for a `classify-thread` job.
 * One job per thread that changed during an inbox sync (or triggered manually).
 *
 * `triageOnly` — skip routing (taxonomy node selection) and only re-run
 * the triage metadata analysis (priority, urgency, risk, etc.) on the most
 * recent existing classification record. Used by the "Re-analyze" UI action.
 *
 * `source` — origin of the sort, used for quota attribution. Defaults to LIVE
 * when omitted so older enqueues remain metered as recurring sorts.
 */
export type ClassifyThreadJobData = {
  workspaceId: string;
  /** Internal EmailThread.id — not the Gmail thread ID. */
  emailThreadId: string;
  triageOnly?: boolean;
  source?: ClassifyThreadSource;
};

/** Payload for a `backfill-inbox` job. One job per workspace, run once. */
export type BackfillInboxJobData = {
  workspaceId: string;
};

/**
 * Payload for a `lifecycle-email` job. One job per due user per weekly cycle.
 * The worker aggregates the user's inbox status across all their workspaces and
 * sends a single reminder digest (or skips the send when there is nothing to
 * report), then stamps `User.lifecycleEmailSentAt`.
 */
export type LifecycleEmailJobData = {
  userId: string;
};

/**
 * Payload for a `generate-taxonomy` job. One job per workspace per request; the
 * worker samples the workspace's eligible inbox, generates a personalized
 * taxonomy proposal, and stores it for the user to preview and apply. Dedup by
 * workspaceId prevents stacking concurrent generations.
 */
export type GenerateTaxonomyJobData = {
  workspaceId: string;
};
