import { Prisma } from "@prisma/client";
import { db } from "./client.js";

// Thread-sort usage accounting, per workspace, for a calendar-month window.
//
// A "sort" is one EmailClassification row. Usage is reported per distinct thread
// (COUNT(DISTINCT emailThreadId)) and split by origin:
//   - backfill:  the one-time historical backfill (ClassificationSource.BACKFILL).
//   - recurring: everything else (LIVE / REROUTE / MANUAL).
//
// Only the recurring count is metered by the monthly thread-sort quota; the
// backfill is a separate one-time allowance and never consumes the quota.

/** Per-workspace thread-sort usage for a window, split by origin. */
export interface ThreadSortUsage {
  /** Distinct threads sorted via the one-time historical backfill. */
  backfill: number;
  /** Distinct threads sorted via recurring sources (live / reroute / manual). */
  recurring: number;
}

/**
 * Count distinct threads sorted by *recurring* sources (everything except
 * BACKFILL) in [windowStart, now). This is the number the monthly quota meters.
 *
 * `excludeThreadId` — omit a specific thread from the count. The quota check uses
 * this for the thread it is about to sort: a re-sort of a thread already counted
 * this month must not be blocked (it would not increase the distinct total), and
 * a brand-new thread is allowed only while the *other* threads are below the cap.
 */
export async function countRecurringThreadSorts(
  workspaceId: string,
  windowStart: Date,
  excludeThreadId?: string,
): Promise<number> {
  const [{ count }] = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT "emailThreadId") AS count FROM "EmailClassification"
    WHERE "workspaceId" = ${workspaceId}
      AND "createdAt" >= ${windowStart}
      AND "source" <> 'BACKFILL'
      ${excludeThreadId ? Prisma.sql`AND "emailThreadId" <> ${excludeThreadId}` : Prisma.empty}
  `;
  return Number(count);
}

/**
 * Per-workspace thread-sort usage for [windowStart, now), split into backfill vs
 * recurring distinct-thread counts. A thread sorted by both a backfill and a
 * recurring source is counted once in each bucket (the buckets are independent).
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
    GROUP BY 1
  `;

  const usage: ThreadSortUsage = { backfill: 0, recurring: 0 };
  for (const row of rows) {
    if (row.bucket === "backfill") usage.backfill = Number(row.count);
    else usage.recurring = Number(row.count);
  }
  return usage;
}
