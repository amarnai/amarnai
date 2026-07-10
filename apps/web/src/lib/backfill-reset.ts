import { Prisma } from "@amarnai/db";

// Reset a workspace's backfill so the worker's sync scheduler re-enqueues a fresh
// scan up to the current (possibly higher) plan cap. Shared by the plan-upgrade
// provision path and the first-payment webhook so the two never drift. Re-ingesting
// already-stored threads is idempotent (upsert by provider thread id). Bumping
// backfillGeneration must happen exactly once per unlock, so callers apply this only
// inside a conditional flip (e.g. `firstPaidAt: null` guard) — a redelivered webhook
// must NOT re-run it, or it would cancel a running backfill.
export const BACKFILL_RESCAN_RESET = {
  backfillStatus: "PENDING",
  backfillStartedAt: null,
  backfillPageToken: null,
  backfillProcessedCount: 0,
  backfillTotalEstimate: 0,
  backfillSkipped: 0,
  backfillGeneration: { increment: 1 },
  backfillCapReached: false,
  backfillBeyondCount: 0,
  backfillLimitState: "NONE",
} satisfies Prisma.ProviderSyncStateUpdateManyMutationInput;
