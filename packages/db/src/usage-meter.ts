import { MeterKind, WorkspacePlan, Prisma } from "@prisma/client";
import { normalizeInboxKey, getDraftQuotaWindowStart } from "@amarnai/shared";
import { db } from "./client.js";
import { getInboxPlanCeiling } from "./inbox-entitlement.js";

/**
 * A full Prisma client or an interactive-transaction client. The idempotency
 * helpers and recordMeterUsage accept either, so a caller can enlist them in its
 * own transaction (committing the meter atomically with the paired DB result) or
 * call them standalone (they open their own transaction when atomicity matters).
 */
type DbClient = typeof db | Prisma.TransactionClient;

// Reset-immune, inbox-keyed usage accounting. This is the single place that reads
// and writes InboxUsageMeter / InboxBackfillGrant so the four cost meters (backfill,
// thread-sort, draft, taxonomy) never duplicate the upsert/window logic.
//
// The meter key is derived from the connection's gmailAddress via normalizeInboxKey;
// we deliberately do NOT mutate the stored gmailAddress (it doubles as the EmailAccount
// providerAccountId identity across sync/disconnect). OAuth returns each account's
// canonical address, so all connections to one inbox already share the same key.

export { MeterKind };

/** Calendar-month UTC bucket — the single window definition shared by all meters. */
export function meterWindowStart(now = new Date()): Date {
  return getDraftQuotaWindowStart(now);
}

/**
 * Rolling window over which an inbox may claim at most one grace re-import.
 * The base backfill budget still replenishes monthly (the calendar-month meter
 * bucket); only the grace (2×cap) allowance is gated by this longer window.
 */
export const GRACE_ROLLING_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/** Normalize a raw gmail address into the pooling key used by every meter. */
export function inboxKeyFor(gmailAddress: string): string {
  return normalizeInboxKey(gmailAddress);
}

/** Current usage for an inbox+kind in the given window (0 if no row yet). */
export async function getMeterUsed(
  inboxKey: string,
  kind: MeterKind,
  windowStart: Date,
): Promise<number> {
  const row = await db.inboxUsageMeter.findUnique({
    where: { inboxKey_kind_windowStart: { inboxKey, kind, windowStart } },
    select: { used: true },
  });
  return row?.used ?? 0;
}

/**
 * Whether the inbox has claimed a grace re-import within the rolling 12-month window
 * (false if none). Read-only. Used by the sync-status banner reconciliation to tell
 * "still capped, retry available" (CAPPED) from "grace already spent this year"
 * (BLOCKED) without re-running the budget resolver. Because the grace gate is now
 * rolling — not per calendar month — this looks across ALL of the inbox's BACKFILL
 * rows, not just the current window's.
 */
export async function getBackfillGraceUsed(
  inboxKey: string,
  now = new Date(),
): Promise<boolean> {
  const row = await db.inboxUsageMeter.findFirst({
    where: {
      inboxKey,
      kind: MeterKind.BACKFILL,
      graceClaimedAt: { gte: new Date(now.getTime() - GRACE_ROLLING_WINDOW_MS) },
    },
    select: { id: true },
  });
  return row != null;
}

/**
 * Claim a one-time idempotency token. Returns true if THIS caller won the claim
 * (first time the token is seen) and false if it was already claimed (a replay).
 * The unique index on `token` makes the INSERT the arbiter, so two concurrent
 * claims collapse in the DB rather than in application logic. Pass `client` to
 * enlist the claim in a surrounding transaction so it commits atomically with the
 * write it guards. See the IdempotencyMarker model.
 */
export async function claimIdempotencyToken(token: string, client: DbClient = db): Promise<boolean> {
  const res = await client.idempotencyMarker.createMany({
    data: [{ token }],
    skipDuplicates: true,
  });
  return res.count === 1;
}

/**
 * Release a previously-claimed token so a later attempt may re-run the guarded
 * effect. Used when a side effect is claimed BEFORE it runs (to bar a concurrent
 * duplicate) but then fails: the claim is rolled back so a retry is not suppressed.
 * A no-op when the token was never claimed.
 */
export async function releaseIdempotencyToken(token: string, client: DbClient = db): Promise<void> {
  await client.idempotencyMarker.deleteMany({ where: { token } });
}

/**
 * How long an idempotency marker is retained before the maintenance sweep may
 * delete it. A marker only needs to outlive every horizon on which a duplicate or
 * retry of the job that wrote it could still fire: BullMQ retry/stall backoff is
 * minutes, and the longest-lived case is the calendar-month meter window (a token
 * far past its window will never be re-presented, because a later job in a new
 * window builds a new token). 90 days is comfortably beyond all of those, so a
 * pruned row can never cause a double-count.
 */
export const IDEMPOTENCY_MARKER_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Delete idempotency markers older than the retention window. The markers table is
 * append-only on the hottest write path (one row per metered unit of work), so
 * without this it grows without bound and the unique index degrades. Safe because a
 * marker past IDEMPOTENCY_MARKER_RETENTION_MS is dead weight — no in-flight or
 * future job can still present that token (see the constant). Returns the number
 * deleted. Idempotent and safe to run repeatedly; the worker calls it on a daily tick.
 */
export async function pruneIdempotencyMarkers(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_MARKER_RETENTION_MS);
  const { count } = await db.idempotencyMarker.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}

/**
 * Add `delta` to an inbox+kind meter for the window. Monotonic — never decrements.
 * `sizedForPlan` is recorded once (on create) for observability of which plan sized
 * the window.
 *
 * Idempotency: pass a stable `dedupToken` and a replay with the same token is a no-op
 * instead of a second +1 — the single mechanism that makes a retried or duplicated
 * worker job count a unit at most once (see IdempotencyMarker). The token claim and
 * the increment always commit together: pass `tx` to enlist them in a caller's
 * transaction (so the meter commits atomically with the DB result it is paired with),
 * or omit it and this opens its own transaction. Callers that are already exactly-once
 * by construction may omit `dedupToken`, preserving the original single-statement upsert.
 */
export async function recordMeterUsage(params: {
  inboxKey: string;
  kind: MeterKind;
  windowStart: Date;
  delta: number;
  sizedForPlan?: WorkspacePlan;
  dedupToken?: string;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const { inboxKey, kind, windowStart, delta, sizedForPlan, dedupToken, tx } = params;
  if (delta <= 0) return;

  const apply = async (client: DbClient): Promise<void> => {
    // First claim of the token wins; a replay finds it already claimed and skips the
    // increment entirely. Claim + increment share `client`, so under `tx` (or the
    // fallback transaction below) they can never tear apart across a crash.
    if (dedupToken && !(await claimIdempotencyToken(dedupToken, client))) return;
    await client.inboxUsageMeter.upsert({
      where: { inboxKey_kind_windowStart: { inboxKey, kind, windowStart } },
      create: { inboxKey, kind, windowStart, used: delta, sizedForPlan: sizedForPlan ?? null },
      update: { used: { increment: delta } },
    });
  };

  if (tx) return apply(tx);
  // Standalone with a token: wrap so the claim and the increment commit atomically.
  // Standalone without a token: the bare upsert (unchanged behavior).
  if (dedupToken) {
    await db.$transaction(apply);
    return;
  }
  await apply(db);
}

export interface InboxQuota {
  /** Normalized inbox identity — the pooling/meter key. */
  inboxKey: string;
  /** Calendar-month UTC window bucket. */
  windowStart: Date;
  /** Top plan among workspaces sharing this inbox — sizes the per-kind limit. */
  plan: WorkspacePlan;
  /** Usage recorded for this inbox+kind in the current window. */
  used: number;
}

/**
 * Resolve the inbox-keyed quota context for a connected inbox: the meter key, the
 * window, the pooled plan ceiling, and current usage. The single source for the
 * read pattern shared by every quota gate (thread-sort, draft, taxonomy) so the
 * keying and window logic never drift between call sites. Callers map `plan` to a
 * limit via the per-kind get*Limit helper and compare against `used`.
 */
export async function resolveInboxQuota(
  gmailAddress: string,
  kind: MeterKind,
  now?: Date,
): Promise<InboxQuota> {
  const inboxKey = inboxKeyFor(gmailAddress);
  const windowStart = meterWindowStart(now);
  const { plan } = await getInboxPlanCeiling(gmailAddress);
  const used = await getMeterUsed(inboxKey, kind, windowStart);
  return { inboxKey, windowStart, plan, used };
}

/**
 * Record that a workspace has been granted its one-time free import of this inbox.
 * Idempotent. Called both inside the enforced budget path and when enforcement is
 * OFF, so toggling ENFORCE_BACKFILL_QUOTA never strands a workspace: a workspace
 * that imported under enforcement-off still has a grant and stays grace-eligible
 * (rather than blocked) if enforcement is later turned on.
 */
export async function ensureBackfillGrant(inboxKey: string, workspaceId: string): Promise<void> {
  await db.inboxBackfillGrant.upsert({
    where: { inboxKey_workspaceId: { inboxKey, workspaceId } },
    create: { inboxKey, workspaceId },
    update: {},
  });
}

export interface BackfillBudget {
  /** Threads this run may still process for the inbox this window. */
  effectiveBudget: number;
  /**
   * True when this import is drawing on the grace (second-cap) allowance — i.e. a
   * post-reset re-import. Stays true across all chunks of that re-import, not just
   * the one that claimed the token. Drives the "retry" vs "initial" banner copy.
   */
  usingGrace: boolean;
  /** True when budget is 0 because the per-inbox budget AND grace are both spent. */
  blockedAwaitingWindow: boolean;
}

/**
 * Resolve how many more historical threads a backfill run may import for an inbox,
 * enforcing the pooled per-inbox monthly cap with a single grace re-import:
 *
 *   - effective ceiling = cap normally, or 2×cap once the grace has been unlocked.
 *   - while used < ceiling: import the remainder (ensures a per-workspace grant so a
 *     later post-reset re-import by the SAME workspace is recognized as a re-run).
 *   - when the BASE cap is hit AND this workspace already imported (grant exists) AND
 *     the inbox has NOT claimed a grace re-import in the last 12 months: atomically
 *     unlock the grace, lifting the ceiling to 2×cap for the rest of the month. The
 *     graceUsed flag stays set, so EVERY subsequent chunk of that re-import keeps
 *     drawing the second cap (this is why the ceiling — not the one-shot token — gates
 *     the budget; otherwise a multi-chunk re-import would stall after its first chunk).
 *   - otherwise: 0 (blocked until the base window rolls over, or until the rolling
 *     12-month grace window elapses if grace is what's exhausted).
 *
 * The base budget replenishes monthly (cap per calendar-month window); the grace
 * (the extra cap on top) is limited to ONE claim per inbox per rolling 12 months.
 * Idempotent and resume-safe: budget is recomputed from the reset-immune meter on
 * every run.
 */
export async function resolveBackfillBudget(params: {
  inboxKey: string;
  workspaceId: string;
  cap: number;
  windowStart: Date;
}): Promise<BackfillBudget> {
  const { inboxKey, workspaceId, cap, windowStart } = params;

  const meter = await db.inboxUsageMeter.findUnique({
    where: { inboxKey_kind_windowStart: { inboxKey, kind: "BACKFILL", windowStart } },
    select: { used: true, graceUsed: true },
  });
  const used = meter?.used ?? 0;
  const graceUsed = meter?.graceUsed ?? false;

  // Once the grace is unlocked, the ceiling is 2×cap and stays there for the window,
  // so resumes of the grace re-import keep their budget chunk after chunk.
  const ceiling = graceUsed ? 2 * cap : cap;
  const remaining = Math.max(0, ceiling - used);
  if (remaining > 0) {
    await ensureBackfillGrant(inboxKey, workspaceId);
    return { effectiveBudget: remaining, usingGrace: graceUsed, blockedAwaitingWindow: false };
  }

  // At the BASE cap (grace not yet unlocked): a workspace that already imported this
  // inbox (a reset re-run) may unlock the one grace re-import for this window.
  if (!graceUsed) {
    const grant = await db.inboxBackfillGrant.findUnique({
      where: { inboxKey_workspaceId: { inboxKey, workspaceId } },
      select: { id: true },
    });
    if (grant) {
      // Rolling 12-month gate: an inbox may claim only one grace re-import per year.
      // If it already claimed one within the window, block (base pool still replenishes
      // monthly; only this extra allowance is rate-limited across months).
      const now = new Date();
      const recentClaim = await db.inboxUsageMeter.findFirst({
        where: {
          inboxKey,
          kind: "BACKFILL",
          graceClaimedAt: { gte: new Date(now.getTime() - GRACE_ROLLING_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (recentClaim) {
        return { effectiveBudget: 0, usingGrace: false, blockedAwaitingWindow: true };
      }
      // Claim the single grace token ATOMICALLY: only the run whose conditional
      // update flips graceUsed false->true wins it, stamping graceClaimedAt in the
      // same statement (one write, no partial state). Without this, two concurrent
      // backfills for the same inbox (e.g. two workspaces sharing it, on separate
      // worker replicas) could each grant a 2×cap budget, blowing past the bound.
      const claim = await db.inboxUsageMeter.updateMany({
        where: { inboxKey, kind: "BACKFILL", windowStart, graceUsed: false },
        data: { graceUsed: true, graceClaimedAt: now },
      });
      if (claim.count === 1) {
        return { effectiveBudget: Math.max(0, 2 * cap - used), usingGrace: true, blockedAwaitingWindow: false };
      }
      // Lost the race — another run already took this window's grace.
      return { effectiveBudget: 0, usingGrace: false, blockedAwaitingWindow: true };
    }
    // No grant (a new workspace arriving after the pool is drained): no allowance,
    // but not "blocked after grace" — it simply has no import budget here.
    return { effectiveBudget: 0, usingGrace: false, blockedAwaitingWindow: false };
  }

  // graceUsed && used >= 2×cap: the full monthly allowance (base + grace) is spent.
  return { effectiveBudget: 0, usingGrace: true, blockedAwaitingWindow: true };
}
