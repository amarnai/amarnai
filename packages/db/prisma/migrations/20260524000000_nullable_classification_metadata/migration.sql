-- AlterTable: make classification metadata fields nullable.
-- These fields are only produced by the legacy single-pass classifier.
-- The embedding pipeline (sortThreadByEmbedding) does not generate metadata;
-- enrichment is a separate concern.
ALTER TABLE "EmailClassification" ALTER COLUMN "priority" DROP NOT NULL;
ALTER TABLE "EmailClassification" ALTER COLUMN "urgency" DROP NOT NULL;
ALTER TABLE "EmailClassification" ALTER COLUMN "riskLevel" DROP NOT NULL;
ALTER TABLE "EmailClassification" ALTER COLUMN "requiredAction" DROP NOT NULL;
ALTER TABLE "EmailClassification" ALTER COLUMN "sensitivity" DROP NOT NULL;
ALTER TABLE "EmailClassification" ALTER COLUMN "suggestedNextStep" DROP NOT NULL;
