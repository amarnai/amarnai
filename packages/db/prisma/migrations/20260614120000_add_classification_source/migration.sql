-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('LIVE', 'BACKFILL', 'REROUTE', 'MANUAL');

-- AlterTable
-- Existing rows default to LIVE (a recurring source) so prior sorts continue to
-- count toward the monthly quota. The one-time backfill is tagged BACKFILL going
-- forward and is excluded from the recurring count.
ALTER TABLE "EmailClassification" ADD COLUMN "source" "ClassificationSource" NOT NULL DEFAULT 'LIVE';

-- CreateIndex
CREATE INDEX "EmailClassification_workspaceId_createdAt_source_idx" ON "EmailClassification"("workspaceId", "createdAt", "source");
