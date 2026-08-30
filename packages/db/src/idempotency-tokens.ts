// Single source of truth for idempotency-marker token shapes.
//
// A token IS the exactly-once contract: recordMeterUsage (and the lifecycle send
// gate) treat two calls with the same token as the same unit of work. If the string
// format drifted or collided between the call sites that build it, a retried job
// would silently double-count or a distinct unit would be wrongly suppressed. Keeping
// every shape here — instead of hand-assembling template literals at each site — makes
// a format change one edit, and makes dimensions like backfill continuation-vs-terminal
// a typed argument rather than a hand-maintained "_done" suffix.
//
// These are pure string builders (no DB access); they live beside the IdempotencyMarker
// ledger in @aziru/db because that is the single place the tokens are consumed.

/** A distinct thread sorted once per inbox per meter window (classify worker + the
 *  synchronous gmail-sort route share this shape). */
export function threadSortDedupToken(inboxKey: string, windowStart: Date, emailThreadId: string): string {
  return `THREAD_SORT_${inboxKey}_${windowStart.toISOString()}_${emailThreadId}`;
}

/** One backfill chunk: the run's generation and the cursor span it advanced. `phase`
 *  distinguishes a mid-run continuation from the terminal DONE write so their tokens can
 *  never collide even on an identical span (a run either continues or completes). */
export function backfillChunkDedupToken(params: {
  inboxKey: string;
  windowStart: Date;
  generation: number;
  startProcessed: number;
  processed: number;
  phase: "continuation" | "done";
}): string {
  const { inboxKey, windowStart, generation, startProcessed, processed, phase } = params;
  const base = `BACKFILL_${inboxKey}_${windowStart.toISOString()}_g${generation}_${startProcessed}_${processed}`;
  return phase === "done" ? `${base}_done` : base;
}

/** One taxonomy generation, identified by its job's stable idempotency key. */
export function taxonomyGenDedupToken(jobKey: string): string {
  return `TAXONOMY_GEN_${jobKey}`;
}

/** One lifecycle reminder send, identified by its job's stable idempotency key. Gates
 *  the (external) send via the same ledger rather than a meter increment. */
export function lifecycleSendDedupToken(jobKey: string): string {
  return `LIFECYCLE_${jobKey}`;
}
