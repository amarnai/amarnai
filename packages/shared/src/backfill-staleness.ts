/** RUNNING status is considered stale after this many ms (1 hour). */
export const BACKFILL_RUNNING_STALE_MS = 60 * 60 * 1_000;

/**
 * Returns true when a backfill should be (re-)started.
 *
 * - PENDING / ERROR: always resumable.
 * - DONE: never resumable.
 * - RUNNING: resumable only when backfillStartedAt is null or older than
 *   BACKFILL_RUNNING_STALE_MS — i.e. the job that set RUNNING is gone.
 */
export function isBackfillResumable(
  status: string,
  startedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (status === "PENDING" || status === "ERROR") return true;
  if (status === "DONE") return false;
  if (status === "RUNNING") {
    if (startedAt === null) return true;
    return now.getTime() - startedAt.getTime() > BACKFILL_RUNNING_STALE_MS;
  }
  return false;
}
