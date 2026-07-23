import { db } from "./client.js";

// How long a low-confidence sort may sit in the review queue before it is
// accepted automatically. A NEEDS_REVIEW thread is already filed under its
// predicted folder; the flag only asks a human to sanity-check it. Leaving it
// untouched for this long is tacit approval — the user had the thread in front
// of them and did not object — so the flag clears and the thread leaves the
// review queue. Tuned for the hosted product; self-host may override.
export const REVIEW_DECAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Promotes stale NEEDS_REVIEW threads to SORTED: those whose most recent
// classification is older than the decay window. Anchoring on the latest
// classification's age (not the thread's updatedAt, which sync and unrelated
// user actions bump) means the timer resets only on a genuine re-sort — a new
// message re-classifies the thread, and a manual move already sets SORTED. A
// thread in NEEDS_REVIEW always has at least one classification (the sort that
// flagged it), so "no classification newer than the cutoff" == "the latest is
// older than the cutoff".
//
// Runs as a periodic worker sweep. Idempotent and retry-safe: the update is
// re-guarded on triageStatus === NEEDS_REVIEW, so a thread that changed between
// the scan and the write (a fresh message, a manual move) is skipped rather
// than clobbered. No audit event is emitted — an ignored thread is a weak
// positive signal at best and would bias the sorter's calibration if recorded
// as a confirmed label. Returns the number of threads promoted.
export async function decayStaleReviews(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REVIEW_DECAY_TTL_MS);

  const stale = await db.emailThread.findMany({
    where: {
      triageStatus: "NEEDS_REVIEW",
      classifications: { none: { createdAt: { gte: cutoff } } },
    },
    select: { id: true },
  });
  if (stale.length === 0) return 0;

  const { count } = await db.emailThread.updateMany({
    where: {
      id: { in: stale.map((t) => t.id) },
      // Re-guard against a race: only promote rows still awaiting review.
      triageStatus: "NEEDS_REVIEW",
    },
    data: { triageStatus: "SORTED" },
  });
  return count;
}
