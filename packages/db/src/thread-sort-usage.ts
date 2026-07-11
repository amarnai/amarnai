import { db } from "./client.js";

// Thread-sort usage accounting, per workspace, for a calendar-month window,
// split by origin:
//   - backfill:  the one-time historical backfill (ClassificationSource.BACKFILL).
//   - recurring: AI sorts that meter the quota (LIVE / REROUTE / MANUAL).
//
// This is a READ-ONLY analytics view over EmailClassification rows, surfaced in
// the usage UI. It is NOT the quota source. The monthly thread-sort quota is
// gated and accounted exclusively on the reset-immune, inbox-pooled
// InboxUsageMeter (see usage-meter.ts / resolveInboxQuota). EmailClassification
// rows are deleted by resetWorkspaceData, so counting over them would refund a
// user's quota on disconnect+reconnect — which is precisely why the meter, not
// this view, is the single source of truth for the gate.

/** Per-workspace thread-sort usage for a window, split by origin. */
export interface ThreadSortUsage {
  /** Distinct threads sorted via the one-time historical backfill. */
  backfill: number;
  /** Distinct threads sorted via recurring AI sources (live / reroute / manual). */
  recurring: number;
}

/**
 * Per-workspace thread-sort usage for [windowStart, now), split into backfill vs
 * recurring distinct-thread counts. The `recurring` bucket mirrors the origins
 * the quota meters (MOVE and MIGRATION rows are excluded, like BACKFILL). A
 * thread sorted by both a backfill and a recurring source is counted once in
 * each bucket (the buckets are independent).
 *
 * Read-only analytics for the usage UI — never a quota gate (see the file header).
 */
export async function getThreadSortUsage(
  workspaceId: string,
  windowStart: Date,
): Promise<ThreadSortUsage> {
  const rows = await db.$queryRaw<{ bucket: string; count: bigint }[]>`
    SELECT
      CASE WHEN "source" = 'BACKFILL' THEN 'backfill' ELSE 'recurring' END AS bucket,
      COUNT(DISTINCT "emailThreadId") AS count
    FROM "EmailClassification"
    WHERE "workspaceId" = ${workspaceId}
      AND "createdAt" >= ${windowStart}
      AND "source" NOT IN ('MOVE', 'MIGRATION')
    GROUP BY 1
  `;

  const usage: ThreadSortUsage = { backfill: 0, recurring: 0 };
  for (const row of rows) {
    if (row.bucket === "backfill") usage.backfill = Number(row.count);
    else usage.recurring = Number(row.count);
  }
  return usage;
}
