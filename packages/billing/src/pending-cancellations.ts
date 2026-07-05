import { db } from "@amarnai/db";
import { isStripeConfigured } from "./stripe.js";
import { ensureSubscriptionCanceled, clampError } from "./cancel-subscription.js";

// Exponential backoff so a persistently-failing row (e.g. during a Stripe outage)
// is not hammered every tick, while a fresh row is retried promptly. Capped so it
// never backs off beyond a few hours.
const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000; // 6 hours

// Cap how many rows one tick reconciles, so a large deletion burst cannot make a
// single tick fan out an unbounded number of serial Stripe calls. The remainder is
// picked up on the next tick (oldest-first ordering below keeps it fair).
const PROCESS_BATCH_SIZE = 100;

// A row that keeps failing past this many attempts is surfaced (logged) each tick.
// We do NOT stop retrying — the hard guarantee that a deleted account stops paying
// must survive even a multi-day outage — but a persistently stuck row means the
// Stripe integration needs a human look, so make it loud rather than silent.
const ATTEMPTS_WARN_THRESHOLD = 20;

function isDue(row: { attempts: number; lastAttemptAt: Date | null }, now: number): boolean {
  if (!row.lastAttemptAt) return true;
  const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, row.attempts - 1));
  return now >= row.lastAttemptAt.getTime() + delay;
}

/**
 * Enqueue a subscription for autonomous cancellation by the worker. Idempotent
 * (unique on stripeSubscriptionId). Used when we know a subscription must be
 * canceled but can't do it inline — e.g. an orphaned checkout whose account is
 * already gone. `processPendingSubscriptionCancellations` reconciles it later.
 */
export async function queueSubscriptionCancellation(
  stripeSubscriptionId: string,
  userId?: string,
): Promise<void> {
  await db.pendingSubscriptionCancellation.upsert({
    where: { stripeSubscriptionId },
    create: { stripeSubscriptionId, userId: userId ?? null },
    update: {},
  });
}

/**
 * Reconcile pending subscription cancellations against Stripe. Fully autonomous:
 * each row is retrieve-then-canceled; once the subscription can no longer bill
 * (canceled or gone) the row is deleted, otherwise its attempt count/backoff are
 * updated and it is retried on a later tick. Returns the number resolved this run.
 *
 * No-op when Stripe is unconfigured (self-host without billing). Idempotent and
 * restart-safe — the DB rows are the only state.
 */
export async function processPendingSubscriptionCancellations(): Promise<number> {
  if (!isStripeConfigured()) return 0;

  // Oldest-attempted first (never-attempted rows sort first), bounded per tick so a
  // deletion burst cannot fan out unbounded serial Stripe calls in one run.
  const rows = await db.pendingSubscriptionCancellation.findMany({
    orderBy: { lastAttemptAt: { sort: "asc", nulls: "first" } },
    take: PROCESS_BATCH_SIZE,
  });
  if (rows.length === 0) return 0;

  const now = Date.now();
  let resolved = 0;

  for (const row of rows) {
    if (!isDue(row, now)) continue;

    const result = await ensureSubscriptionCanceled(row.stripeSubscriptionId);
    if (result.done) {
      await db.pendingSubscriptionCancellation.delete({ where: { id: row.id } });
      resolved++;
    } else {
      if (row.attempts + 1 >= ATTEMPTS_WARN_THRESHOLD) {
        console.warn(
          `[billing-cancellation] Subscription ${row.stripeSubscriptionId} still uncanceled after ` +
            `${row.attempts + 1} attempts: ${result.error.message}`,
        );
      }
      await db.pendingSubscriptionCancellation.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: clampError(result.error.message),
          lastAttemptAt: new Date(),
        },
      });
    }
  }

  return resolved;
}
