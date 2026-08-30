/**
 * One-time cutover migration for inbox-keyed usage metering.
 *
 * The meters (InboxUsageMeter / InboxBackfillGrant) are reset-immune and pooled by
 * normalized inbox address. On a fresh deploy they start empty, which would hand
 * every existing inbox a full fresh budget for the cutover month and a free
 * re-import. This script seeds them from current state so the cutover is not a
 * free-for-all:
 *
 *   - THREAD_SORT / DRAFT / TAXONOMY_GEN: seed `used` for the current calendar
 *     month from existing rows, taking the MAX across workspaces that share an
 *     inbox (pooling).
 *   - BACKFILL: seed `used` from each inbox's completed import and pre-seed an
 *     InboxBackfillGrant per (inbox, workspace) whose backfill is DONE, so an
 *     already-imported inbox is treated as a re-run (grace), not a fresh import.
 *
 * Idempotent: re-running recomputes and upserts the same rows. Forward-only.
 *
 * Usage:
 *   pnpm --filter @aziru/db tsx prisma/seed-inbox-usage-meters.ts
 */
import { db, inboxKeyFor, meterWindowStart, MeterKind } from "../src/index.js";

type Agg = { threadSort: number; draft: number; taxonomyGen: number; backfill: number; backfillDone: boolean };

async function main() {
  const windowStart = meterWindowStart();
  console.log(`Seeding inbox usage meters for window ${windowStart.toISOString()}…`);

  const connections = await db.emailConnection.findMany({
    select: { workspaceId: true, emailAddress: true },
  });
  console.log(`Found ${connections.length} Gmail connection(s).`);

  // inboxKey -> aggregated usage (max across sharing workspaces), plus the set of
  // workspaces whose backfill is DONE (for grant pre-seeding).
  const byInbox = new Map<string, Agg>();
  const doneGrants: { inboxKey: string; workspaceId: string }[] = [];

  for (const conn of connections) {
    const inboxKey = inboxKeyFor(conn.emailAddress);
    const workspaceId = conn.workspaceId;

    const [threadSort, draft, taxState, syncState] = await Promise.all([
      db.emailClassification
        .findMany({
          where: {
            workspaceId,
            createdAt: { gte: windowStart },
            source: { notIn: ["BACKFILL", "MOVE", "MIGRATION"] },
          },
          distinct: ["emailThreadId"],
          select: { emailThreadId: true },
        })
        .then((rows) => rows.length),
      db.draft.count({
        where: {
          workspaceId,
          createdAt: { gte: windowStart },
          status: { in: ["PROPOSED", "SENT", "CREATED_IN_GMAIL", "GENERATING"] },
        },
      }),
      db.taxonomyGenerationState.findUnique({
        where: { workspaceId },
        select: { generationsWindowStart: true, generationsInWindow: true },
      }),
      db.providerSyncState.findFirst({
        where: { emailAccount: { workspaceId } },
        select: { backfillStatus: true, backfillProcessedCount: true },
      }),
    ]);

    // Taxonomy generations counted in the legacy rolling window are treated as this
    // month's usage (conservative: never under-counts the cutover month).
    const taxonomyGen =
      taxState?.generationsWindowStart &&
      taxState.generationsWindowStart.getTime() >= windowStart.getTime() - 31 * 24 * 60 * 60 * 1000
        ? taxState.generationsInWindow
        : 0;

    const backfillDone = syncState?.backfillStatus === "DONE";
    const backfill = backfillDone ? syncState?.backfillProcessedCount ?? 0 : 0;

    const prev = byInbox.get(inboxKey) ?? {
      threadSort: 0,
      draft: 0,
      taxonomyGen: 0,
      backfill: 0,
      backfillDone: false,
    };
    byInbox.set(inboxKey, {
      threadSort: Math.max(prev.threadSort, threadSort),
      draft: Math.max(prev.draft, draft),
      taxonomyGen: Math.max(prev.taxonomyGen, taxonomyGen),
      backfill: Math.max(prev.backfill, backfill),
      backfillDone: prev.backfillDone || backfillDone,
    });

    if (backfillDone) doneGrants.push({ inboxKey, workspaceId });
  }

  let meters = 0;
  for (const [inboxKey, agg] of byInbox) {
    const seed = async (kind: MeterKind, used: number, graceUsed = false) => {
      if (used <= 0 && !graceUsed) return;
      await db.inboxUsageMeter.upsert({
        where: { inboxKey_kind_windowStart: { inboxKey, kind, windowStart } },
        create: { inboxKey, kind, windowStart, used, graceUsed },
        update: { used, graceUsed },
      });
      meters++;
    };
    await seed("THREAD_SORT", agg.threadSort);
    await seed("DRAFT", agg.draft);
    await seed("TAXONOMY_GEN", agg.taxonomyGen);
    // A DONE inbox has already spent its import: seed the pool to the cap-equivalent
    // (its processed count) so a re-import draws the grace, not a fresh allowance.
    await seed("BACKFILL", agg.backfill);
  }

  let grants = 0;
  for (const g of doneGrants) {
    await db.inboxBackfillGrant.upsert({
      where: { inboxKey_workspaceId: { inboxKey: g.inboxKey, workspaceId: g.workspaceId } },
      create: { inboxKey: g.inboxKey, workspaceId: g.workspaceId },
      update: {},
    });
    grants++;
  }

  console.log(`Seeded ${meters} meter row(s) across ${byInbox.size} inbox(es) and ${grants} backfill grant(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
