import { MeterKind, WorkspacePlan } from "@prisma/client";
import { normalizeInboxKey, getDraftQuotaWindowStart } from "@amarnai/shared";
import { db } from "./client.js";
import { getInboxPlanCeiling } from "./inbox-entitlement.js";

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
 * Add `delta` to an inbox+kind meter for the window. Monotonic — never decrements.
 * `sizedForPlan` is recorded once (on create) for observability of which plan sized
 * the window. Safe to call repeatedly; concurrent callers may overshoot a soft cap,
 * which the existing quota paths already tolerate.
 */
export async function recordMeterUsage(params: {
  inboxKey: string;
  kind: MeterKind;
  windowStart: Date;
  delta: number;
  sizedForPlan?: WorkspacePlan;
}): Promise<void> {
  const { inboxKey, kind, windowStart, delta, sizedForPlan } = params;
  if (delta <= 0) return;
  await db.inboxUsageMeter.upsert({
    where: { inboxKey_kind_windowStart: { inboxKey, kind, windowStart } },
    create: { inboxKey, kind, windowStart, used: delta, sizedForPlan: sizedForPlan ?? null },
    update: { used: { increment: delta } },
  });
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
  /** True when this resolution consumed the single per-(inbox,month) grace token. */
  graceConsumed: boolean;
  /** True when budget is 0 because the grace was already spent (vs. simply within cap). */
  blockedAwaitingWindow: boolean;
}

/**
 * Resolve how many more historical threads a backfill run may import for an inbox,
 * enforcing the pooled per-inbox monthly cap with a single grace re-import:
 *
 *   - base budget = cap − used (shared across all workspaces on this inbox).
 *   - while base > 0: import from it (ensures a per-workspace grant exists so a later
 *     re-import by the SAME workspace is recognized as a re-run, not a fresh import).
 *   - when base is exhausted AND this workspace already imported before (grant exists):
 *     consume the one grace token to lift the ceiling to 2×cap for the rest of the month.
 *   - otherwise: 0 (blocked until the window rolls over).
 *
 * Total imports per inbox per month are therefore bounded by 2×cap. Idempotent and
 * resume-safe: budget is recomputed from the reset-immune meter on every run; the grant
 * upsert and graceUsed flag are set-once.
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

  const base = Math.max(0, cap - used);
  if (base > 0) {
    // First import or resume: ensure the per-workspace grant exists so a later
    // post-reset re-import by this workspace is recognized as a re-run.
    await ensureBackfillGrant(inboxKey, workspaceId);
    return { effectiveBudget: base, graceConsumed: false, blockedAwaitingWindow: false };
  }

  // Pool exhausted. The grace re-import is available only to a workspace that has
  // already imported this inbox (a reset re-run), and only once per inbox per month.
  if (!graceUsed) {
    const grant = await db.inboxBackfillGrant.findUnique({
      where: { inboxKey_workspaceId: { inboxKey, workspaceId } },
      select: { id: true },
    });
    if (grant) {
      // Claim the single grace token ATOMICALLY: only the run whose conditional
      // update flips graceUsed false->true wins it. Without this, two concurrent
      // backfills for the same inbox (e.g. two workspaces sharing it, on separate
      // worker replicas) could each read graceUsed=false and both grant a 2x-cap
      // budget, blowing past the 2x-cap/inbox/month bound. The row is guaranteed to
      // exist here (used >= cap > 0 came from it). Mirrors the backfill claim guard.
      const claim = await db.inboxUsageMeter.updateMany({
        where: { inboxKey, kind: "BACKFILL", windowStart, graceUsed: false },
        data: { graceUsed: true },
      });
      if (claim.count === 1) {
        return {
          effectiveBudget: Math.max(0, 2 * cap - used),
          graceConsumed: true,
          blockedAwaitingWindow: false,
        };
      }
      // Lost the race — another run already took this window's grace.
      return { effectiveBudget: 0, graceConsumed: false, blockedAwaitingWindow: true };
    }
  }

  return { effectiveBudget: 0, graceConsumed: false, blockedAwaitingWindow: graceUsed };
}
