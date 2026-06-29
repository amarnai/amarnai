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
// Async Batch-API backfill (BACKFILL_BATCH_MODE). `batch-poll` watches a Gemini
// batch job until it settles; `route-batch` runs the offline routing pass over a
// workspace's vector'd threads and submits LLM escalation batches.
export const QUEUE_BATCH_POLL = "batch-poll";
export const QUEUE_ROUTE_BATCH = "route-batch";
// "Route now" in batch mode: embed-batch the PENDING/UNROUTED backlog (fetching
// bodies) instead of enqueueing per-thread classify jobs. Works during or after
// a backfill.
export const QUEUE_ROUTE_BACKLOG = "route-backlog";

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
  /** Locale of the user who triggered generation; the LLM writes folder
   * names/descriptions in this language. Optional for back-compat with jobs
   * enqueued before localization (the worker falls back to the source locale). */
  locale?: string;
};

/**
 * Payload for a `batch-poll` job (BACKFILL_BATCH_MODE). Watches a single
 * submitted Gemini batch (the `AiBatchJob` row) and re-enqueues itself with a
 * delay until the batch settles, then hands off to `route-batch`.
 */
export type BatchPollJobData = {
  workspaceId: string;
  /** AiBatchJob.id — the local batch record (carries kind + providerJobId). */
  batchJobId: string;
};

/**
 * Payload for a `route-batch` job (BACKFILL_BATCH_MODE). Runs the offline
 * deferred-routing pass over the workspace's BatchThreadState rows in ROUTING,
 * finalizing non-escalating threads and submitting an LLM batch for escalations.
 */
export type RouteBatchJobData = {
  workspaceId: string;
  emailAccountId: string;
};

/**
 * Payload for a `route-backlog` job (BACKFILL_BATCH_MODE). Embed-batches a chunk
 * of the workspace's PENDING/UNROUTED backlog and re-enqueues itself until the
 * backlog is drained. Triggered by "Route now" (and the armed backfill) when
 * batch mode is on.
 */
export type RouteBacklogJobData = {
  workspaceId: string;
};
