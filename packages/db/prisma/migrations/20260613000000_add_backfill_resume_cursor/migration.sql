-- AlterTable
ALTER TABLE "ProviderSyncState" ADD COLUMN "backfillPageToken" TEXT;
ALTER TABLE "ProviderSyncState" ADD COLUMN "backfillProcessedCount" INTEGER NOT NULL DEFAULT 0;
