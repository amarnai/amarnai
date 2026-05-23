-- Remove hidden-node and routing-question fields from the taxonomy model.
-- All nodes are now visible category destinations; edges are plain links.

-- TaxonomyNode: drop isVisibleCategory and canReceiveEmails
ALTER TABLE "TaxonomyNode" DROP COLUMN IF EXISTS "isVisibleCategory";
ALTER TABLE "TaxonomyNode" DROP COLUMN IF EXISTS "canReceiveEmails";

-- TaxonomyEdge: drop sortingQuestion, examples, negativeExamples, priority, confidenceThreshold
ALTER TABLE "TaxonomyEdge" DROP COLUMN IF EXISTS "sortingQuestion";
ALTER TABLE "TaxonomyEdge" DROP COLUMN IF EXISTS "examples";
ALTER TABLE "TaxonomyEdge" DROP COLUMN IF EXISTS "negativeExamples";
ALTER TABLE "TaxonomyEdge" DROP COLUMN IF EXISTS "priority";
ALTER TABLE "TaxonomyEdge" DROP COLUMN IF EXISTS "confidenceThreshold";
