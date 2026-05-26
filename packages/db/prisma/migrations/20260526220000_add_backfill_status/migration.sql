-- CreateEnum
CREATE TYPE "BackfillStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'ERROR');

-- AlterTable
ALTER TABLE "ProviderSyncState"
  ADD COLUMN "backfillStatus" "BackfillStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "backfillSkipped" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "backfillCompletedAt" TIMESTAMP(3);
