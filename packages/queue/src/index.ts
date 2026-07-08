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
export const DEDUP_CLASSIFY_NEEDS_REVIEW = "classify_needs_review";
export const DEDUP_CLASSIFY_MIGRATION    = "classify_migration";

// ─── Queue names ──────────────────────────────────────────────────────────────
// Single source of truth. Import these constants everywhere instead of
// hardcoding strings so a rename stays a one-line change.

export const QUEUE_SYNC_INBOX = "sync-inbox";
export const QUEUE_CLASSIFY_THREAD = "classify-thread";
export const QUEUE_BACKFILL_INBOX = "backfill-inbox";
export const QUEUE_LIFECYCLE_EMAIL = "lifecycle-email";
export const QUEUE_GENERATE_TAXONOMY = "generate-taxonomy";
export const QUEUE_PUSH_NOTIFICATION = "push-notification";
export const QUEUE_CAPTURE_REFERENCE = "capture-reference";

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

/**
 * Payload for a `capture-reference` job. Enqueued (best-effort) after a manual
 * move created or repointed the thread's TaxonomyNodeReference row; the worker
 * fills in the row's embedding vector and prunes the node's references to the
 * retention cap. Idempotent: a missing row (undo retracted it) or an
 * already-current embeddingTextHash is a no-op.
 */
export type CaptureReferenceJobData = {
  workspaceId: string;
  /** Internal EmailThread.id — not the provider thread ID. */
  emailThreadId: string;
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
 * Payload for a `push-notification` job. A discriminated union keyed on `kind`
 * so future push producers extend it without a new queue. The worker re-reads
 * the underlying entity and no-ops if state changed since enqueue, making retries
 * idempotent.
 *
 * - `thread_assigned`: addressed to the assignee (never the actor who assigned).
 * - `gmail_disconnected`: fans out to every workspace member's devices after the
 *   connection flipped ACTIVE → DISCONNECTED on an auth failure.
 */
export type PushNotificationJobData =
  | {
      kind: "thread_assigned";
      workspaceId: string;
      /** Internal EmailThread.id. */
      emailThreadId: string;
      /** Recipient: the user the thread was assigned to. */
      assigneeUserId: string;
      /** Actor who made the assignment (for auditing; never pushed to). */
      assignedByUserId: string;
    }
  | {
      kind: "gmail_disconnected";
      workspaceId: string;
    };
