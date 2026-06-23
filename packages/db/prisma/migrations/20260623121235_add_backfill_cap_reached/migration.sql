-- AlterTable
ALTER TABLE "ProviderSyncState" ADD COLUMN     "backfillBeyondCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "backfillCapReached" BOOLEAN NOT NULL DEFAULT false;
