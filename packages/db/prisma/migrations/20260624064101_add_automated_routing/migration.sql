-- AlterTable
ALTER TABLE "EmailThread" ADD COLUMN     "isAutomated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GmailSyncSettings" ADD COLUMN     "routeBulkToOther" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TaxonomyNode" ADD COLUMN     "isCatchAll" BOOLEAN NOT NULL DEFAULT false;
