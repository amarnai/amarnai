-- DropForeignKey
ALTER TABLE "EmailClassification" DROP CONSTRAINT "EmailClassification_finalNodeId_fkey";

-- AddForeignKey
ALTER TABLE "EmailClassification" ADD CONSTRAINT "EmailClassification_finalNodeId_fkey" FOREIGN KEY ("finalNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
