-- AlterTable
ALTER TABLE "ProviderSyncState" ADD COLUMN "backfillGeneration" INTEGER NOT NULL DEFAULT 0;
