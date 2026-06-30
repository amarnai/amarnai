import { MeterKind, WorkspacePlan } from "@prisma/client";
import { normalizeInboxKey, getDraftQuotaWindowStart } from "@amarnai/shared";
import { db } from "./client.js";

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
  sizedForPlan: WorkspacePlan;
}): Promise<BackfillBudget> {
  const { inboxKey, workspaceId, cap, windowStart, sizedForPlan } = params;

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
    await db.inboxBackfillGrant.upsert({
      where: { inboxKey_workspaceId: { inboxKey, workspaceId } },
      create: { inboxKey, workspaceId },
      update: {},
    });
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
      await db.inboxUsageMeter.upsert({
        where: { inboxKey_kind_windowStart: { inboxKey, kind: "BACKFILL", windowStart } },
        create: { inboxKey, kind: "BACKFILL", windowStart, used, graceUsed: true, sizedForPlan },
        update: { graceUsed: true },
      });
      return {
        effectiveBudget: Math.max(0, 2 * cap - used),
        graceConsumed: true,
        blockedAwaitingWindow: false,
      };
    }
  }

  return { effectiveBudget: 0, graceConsumed: false, blockedAwaitingWindow: graceUsed };
}
