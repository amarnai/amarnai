-- AlterTable: add embedding cache columns to TaxonomyNode
ALTER TABLE "TaxonomyNode"
  ADD COLUMN "embeddingVector"    DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
  ADD COLUMN "embeddingModel"     TEXT,
  ADD COLUMN "embeddingTextHash"  TEXT,
  ADD COLUMN "embeddingUpdatedAt" TIMESTAMP(3);
