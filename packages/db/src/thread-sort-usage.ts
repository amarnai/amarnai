import { Prisma } from "@prisma/client";
import { db } from "./client.js";

// Thread-sort usage accounting, per workspace, for a calendar-month window.
//
// A "sort" is one EmailClassification row. Usage is reported per distinct thread
// (COUNT(DISTINCT emailThreadId)) and split by origin:
//   - backfill:  the one-time historical backfill (ClassificationSource.BACKFILL).
//   - recurring: AI sorts that meter the quota (LIVE / REROUTE / MANUAL).
//
// Only the recurring count is metered by the monthly thread-sort quota. Two
// sources never consume it: BACKFILL (a separate one-time allowance) and MOVE
// (a manual folder reassignment, which runs no embedding/LLM and so has zero AI
// cost). These are the UNMETERED_SOURCES below.

/** Classification sources that do NOT consume the monthly thread-sort quota. */
const UNMETERED_SOURCES = ["BACKFILL", "MOVE"] as const;

/** Per-workspace thread-sort usage for a window, split by origin. */
export interface ThreadSortUsage {
  /** Distinct threads sorted via the one-time historical backfill. */
  backfill: number;
  /** Distinct threads sorted via recurring AI sources (live / reroute / manual). */
  recurring: number;
}

/**
 * Count distinct threads sorted by *recurring* sources (everything except the
 * UNMETERED_SOURCES) in [windowStart, now). This is the number the monthly quota
 * meters.
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
      AND "source" NOT IN (${Prisma.join(UNMETERED_SOURCES)})
      ${excludeThreadId ? Prisma.sql`AND "emailThreadId" <> ${excludeThreadId}` : Prisma.empty}
  `;
  return Number(count);
}

/**
 * Per-workspace thread-sort usage for [windowStart, now), split into backfill vs
 * recurring distinct-thread counts. The `recurring` bucket matches what the quota
 * meters, so MOVE rows are excluded (they are unmetered, like BACKFILL). A thread
 * sorted by both a backfill and a recurring source is counted once in each bucket
 * (the buckets are independent).
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
      AND "source" <> 'MOVE'
    GROUP BY 1
  `;

  const usage: ThreadSortUsage = { backfill: 0, recurring: 0 };
  for (const row of rows) {
    if (row.bucket === "backfill") usage.backfill = Number(row.count);
    else usage.recurring = Number(row.count);
  }
  return usage;
}
