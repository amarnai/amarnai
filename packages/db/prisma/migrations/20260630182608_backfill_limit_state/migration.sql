-- CreateEnum
CREATE TYPE "BackfillLimitState" AS ENUM ('NONE', 'CAPPED', 'CAPPED_RETRY', 'BLOCKED');

-- AlterTable
ALTER TABLE "ProviderSyncState" ADD COLUMN     "backfillLimitState" "BackfillLimitState" NOT NULL DEFAULT 'NONE';
