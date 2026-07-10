-- AlterTable
ALTER TABLE "InboxUsageMeter" ADD COLUMN     "graceClaimedAt" TIMESTAMP(3);

-- Backfill graceClaimedAt for meters whose grace was already claimed under the old
-- per-calendar-month rule, so those claims count against the new rolling 12-month
-- window. updatedAt may postdate the actual claim by up to the rest of that month,
-- which is conservative (blocks slightly longer) — acceptable pre-launch.
UPDATE "InboxUsageMeter" SET "graceClaimedAt" = "updatedAt" WHERE "graceUsed" = true;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "firstPaidAt" TIMESTAMP(3);

-- Grandfather every existing paid-plan workspace as already-paid so the backfill
-- payment gate does not retroactively clamp them to the FREE cap. Pre-launch there
-- are no cloud customers; this protects self-host installs and dev/seed data.
UPDATE "Workspace" SET "firstPaidAt" = now() WHERE "plan" <> 'FREE';
