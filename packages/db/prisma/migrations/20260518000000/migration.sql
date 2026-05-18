-- AlterTable: make finalNodeId nullable to support review-needed classifications with no destination node
ALTER TABLE "EmailClassification" ALTER COLUMN "finalNodeId" DROP NOT NULL;
