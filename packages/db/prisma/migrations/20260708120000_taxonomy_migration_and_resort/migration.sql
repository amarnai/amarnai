-- AlterEnum
ALTER TYPE "ClassificationSource" ADD VALUE 'MIGRATION';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "taxonomyChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EmailClassification" ADD COLUMN     "transientFailure" BOOLEAN NOT NULL DEFAULT false;
